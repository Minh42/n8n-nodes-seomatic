/**
 * Offline tests for the built nodes (run `npm run build` first, then `node test/node-tests.cjs`).
 * Not shipped: package.json "files" only publishes dist/.
 *
 * Every operation runs through the real execute() with a mocked httpRequestWithAuthentication,
 * asserting the exact SEOmatic URL (tool name) and body, result parsing, Simplify, errors,
 * continueOnFail, list search, and the trigger's webhook lifecycle and signature checks.
 */
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { NodeApiError, NodeOperationError } = require('n8n-workflow');
const { Seomatic } = require('../dist/nodes/Seomatic/Seomatic.node.js');
const {
	SeomaticTrigger,
	verifySignature,
} = require('../dist/nodes/SeomaticTrigger/SeomaticTrigger.node.js');
const { SeomaticApi } = require('../dist/credentials/SeomaticApi.credentials.js');

const BASE = 'https://app.seomatic.ai';
const NODE = {
	id: '1',
	name: 'SEOmatic',
	type: 'n8n-nodes-seomatic.seomatic',
	typeVersion: 2,
	position: [0, 0],
	parameters: {},
};
const UUID = '3f1c2a9e-5b7d-4e8f-9a0b-1c2d3e4f5a6b';
const UUID2 = '9b8c7d6e-5f4a-4b3c-8d2e-1f0a9b8c7d6e';

let passed = 0;
const failures = [];
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

// ----- harness -------------------------------------------------------------------------------

/** What n8n's request helper throws: its own NodeApiError wrapping an Axios error. */
class AxiosError extends Error {
	constructor(status, data) {
		super(`Request failed with status code ${status}`);
		this.name = 'AxiosError';
		this.isAxiosError = true;
		this.response = { status, data };
	}
}
const httpFail = (status, data) => new NodeApiError(NODE, new AxiosError(status, data));
const toolOk = (tool, result) => ({ tool, result: JSON.stringify(result) });

function makeExec({ params, items, respond, continueOnFail = false }) {
	const calls = [];
	const paramsFor = (i) => (Array.isArray(params) ? params[i] : params);
	const ctx = {
		getInputData: () => items ?? [{ json: {} }],
		getNode: () => NODE,
		continueOnFail: () => continueOnFail,
		getNodeParameter(name, i, fallback, opts) {
			const p = paramsFor(i);
			let v = Object.prototype.hasOwnProperty.call(p, name) ? p[name] : fallback;
			if (v === undefined) throw new Error(`Test harness: parameter "${name}" not set`);
			if (opts && opts.extractValue && v && typeof v === 'object' && 'mode' in v) v = v.value;
			return v;
		},
		helpers: {
			async httpRequestWithAuthentication(credentialType, request) {
				calls.push({ credentialType, ...request });
				return await respond(request, calls.length - 1);
			},
		},
	};
	return { ctx, calls, run: () => new Seomatic().execute.call(ctx) };
}

/** Run one operation and return { out, calls } with a single canned tool response. */
async function runOp(params, result, opts = {}) {
	const h = makeExec({
		params,
		respond: (req) => {
			const tool = req.url.split('/').pop();
			return typeof result === 'function' ? result(req) : toolOk(tool, result);
		},
		...opts,
	});
	const [out] = await h.run();
	return { out, calls: h.calls };
}

function expectCall(call, tool, body) {
	assert.equal(call.credentialType, 'seomaticApi');
	assert.equal(call.method, 'POST');
	assert.equal(call.url, `${BASE}/api/v1/tools/${tool}`);
	assert.equal(call.json, true);
	assert.deepEqual(call.body, body);
}

async function expectThrows(promise, check) {
	let error;
	try {
		await promise;
	} catch (e) {
		error = e;
	}
	assert.ok(error, 'expected an error');
	check(error);
}

const sp = (operation, extra = {}) => ({ resource: 'searchPerformance', operation, ...extra });
const task = (operation, extra = {}) => ({
	resource: 'seoTask',
	operation,
	taskId: { mode: 'list', value: UUID },
	...extra,
});

// ----- description -------------------------------------------------------------------------

test('description: resources, operations, usableAsTool, versions', () => {
	const d = new Seomatic().description;
	assert.equal(d.name, 'seomatic');
	assert.deepEqual(d.version, [2]);
	assert.equal(d.usableAsTool, true);
	assert.deepEqual(d.credentials, [{ name: 'seomaticApi', required: true }]);
	const resources = d.properties.find((p) => p.name === 'resource').options.map((o) => o.value);
	assert.deepEqual(resources, [
		'aiVisibility',
		'article',
		'searchPerformance',
		'seoTask',
		'siteAudit',
		'trackedPrompt',
	]);
	const ops = {};
	for (const p of d.properties.filter((p) => p.name === 'operation')) {
		const r = p.displayOptions.show.resource[0];
		ops[r] = p.options.map((o) => o.value);
		for (const o of p.options) {
			assert.ok(o.action && o.description, `${r}.${o.value} has action and description`);
		}
		const names = p.options.map((o) => o.name);
		assert.deepEqual(names, [...names].sort(), `${r} operations sorted`);
	}
	assert.deepEqual(ops, {
		aiVisibility: ['get', 'runScan'],
		article: ['generate', 'get', 'getAll'],
		searchPerformance: [
			'checkIndexing',
			'comparePeriods',
			'findCompetingPages',
			'findLowClickRatePages',
			'getMonthlyTrend',
			'getPages',
			'getQueries',
		],
		seoTask: ['approve', 'dismiss', 'execute', 'get', 'getAll', 'rollback'],
		siteAudit: ['analyzePage', 'run'],
		trackedPrompt: ['create', 'delete', 'getAll', 'update'],
	});
	for (const p of d.properties.filter((p) => p.name === 'simplify')) {
		assert.equal(
			p.description,
			'Whether to return a simplified version of the response instead of the raw data',
		);
	}
	for (const p of d.properties.filter((p) => p.type === 'resourceLocator')) {
		assert.equal(p.default.mode, 'list', `${p.name} defaults to From List`);
	}
	const text = JSON.stringify(d) + JSON.stringify(new SeomaticTrigger().description);
	assert.ok(!text.includes(String.fromCharCode(0x2014)), 'no em dash in UI strings');
	const placeholders = [];
	JSON.stringify(d, (k, v) => {
		if (k === 'placeholder' && typeof v === 'string' && !v.startsWith('Add ')) placeholders.push(v);
		return v;
	});
	for (const ph of placeholders) assert.ok(ph.startsWith('e.g. '), `placeholder "${ph}"`);
});

test('credential: password field, bearer header, test request', () => {
	const c = new SeomaticApi();
	assert.equal(c.properties[0].typeOptions.password, true);
	assert.equal(c.authenticate.properties.headers.Authorization, '=Bearer {{$credentials.apiKey}}');
	assert.equal(c.test.request.baseURL, BASE);
	assert.equal(c.test.request.url, '/api/v1/me');
});

// ----- Search Performance ------------------------------------------------------------------

test('Search Performance > Get Queries: tool, body, one item per query', async () => {
	const { out, calls } = await runOp(sp('getQueries', { limit: 10, options: { days: 7 } }), {
		siteUrl: 'sc-domain:example.com',
		period: 'Last 7 days',
		totalResults: 2,
		queries: [
			{ query: 'running shoes', clicks: 10, impressions: 100, ctr: '10.0%', position: '3.2' },
			{ query: 'trail shoes', clicks: 5, impressions: 80, ctr: '6.3%', position: '5.1' },
		],
	});
	expectCall(calls[0], 'get_search_queries', { days: 7, limit: 10 });
	assert.equal(out.length, 2);
	assert.equal(out[1].json.query, 'trail shoes');
	assert.deepEqual(out[1].pairedItem, { item: 0 });
});

test('Search Performance > Get Pages: default options send only limit', async () => {
	const { out, calls } = await runOp(sp('getPages', { limit: 50, options: {} }), {
		pages: [{ page: 'https://example.com/', clicks: 3 }],
	});
	expectCall(calls[0], 'get_top_pages', { limit: 50 });
	assert.deepEqual(out[0].json, { page: 'https://example.com/', clicks: 3 });
});

test('Search Performance > Compare Periods: option names map to tool fields', async () => {
	const result = { siteUrl: 'x', topLosers: [], topWinners: [], totals: { clicks: 1 } };
	const { out, calls } = await runOp(
		sp('comparePeriods', { options: { dimension: 'query', days: 14, rowsPerPeriod: 100 } }),
		result,
	);
	expectCall(calls[0], 'compare_periods', { dimension: 'query', days: 14, limit: 100 });
	assert.deepEqual(out[0].json, result);
	const empty = await runOp(sp('comparePeriods', { options: {} }), result);
	expectCall(empty.calls[0], 'compare_periods', {});
});

test('Search Performance > Find Competing Pages uses find_cannibalization', async () => {
	const { calls, out } = await runOp(
		sp('findCompetingPages', { options: { days: 30, minImpressions: 50 } }),
		{ cannibalizedCount: 1, cannibalized: [{ query: 'q', pages: [] }] },
	);
	expectCall(calls[0], 'find_cannibalization', { days: 30, minImpressions: 50 });
	assert.equal(out[0].json.cannibalizedCount, 1);
});

test('Search Performance > Find Low Click Rate Pages uses find_ctr_outliers', async () => {
	const { calls } = await runOp(sp('findLowClickRatePages', { options: { minImpressions: 300 } }), {
		outliers: [],
	});
	expectCall(calls[0], 'find_ctr_outliers', { minImpressions: 300 });
});

test('Search Performance > Get Monthly Trend uses get_seasonality_baseline', async () => {
	const { calls, out } = await runOp(sp('getMonthlyTrend'), { months: [], yoy: null });
	expectCall(calls[0], 'get_seasonality_baseline', {});
	assert.deepEqual(out[0].json, { months: [], yoy: null });
});

test('Search Performance > Check Indexing: simplified to 10 flat fields, raw kept', async () => {
	const result = {
		siteUrl: 'sc-domain:example.com',
		inspectedUrl: 'https://example.com/a',
		inspectionResultLink: 'https://search.google.com/x',
		indexing: {
			verdict: 'PASS',
			coverageState: 'Submitted and indexed',
			robotsTxtState: 'ALLOWED',
			indexingState: 'INDEXING_ALLOWED',
			pageFetchState: 'SUCCESSFUL',
			lastCrawlTime: '2026-09-01T00:00:00Z',
			crawledAs: 'MOBILE',
			googleCanonical: 'https://example.com/a',
			userCanonical: 'https://example.com/a',
			referringUrls: [],
			sitemaps: [],
		},
		mobileUsability: null,
		richResults: null,
	};
	const simple = await runOp(
		sp('checkIndexing', { url: ' https://example.com/a ', simplify: true }),
		result,
	);
	expectCall(simple.calls[0], 'inspect_url_indexing', { url: 'https://example.com/a' });
	assert.equal(Object.keys(simple.out[0].json).length, 10);
	assert.equal(simple.out[0].json.verdict, 'PASS');
	const raw = await runOp(
		sp('checkIndexing', { url: 'https://example.com/a', simplify: false }),
		result,
	);
	assert.deepEqual(raw.out[0].json, result);
});

// ----- Site Audit ----------------------------------------------------------------------------

const auditResult = {
	pagesCrawled: 3,
	pagesFailed: [{ url: 'https://example.com/x', reason: 'timeout' }],
	issues: {
		deadPages: [{ url: 'a', status: 404 }],
		brokenInternalLinks: [{ target: 'b', status: 404, linkedFrom: ['a'] }, {}],
		duplicateTitles: [],
		duplicateMetaDescriptions: [],
		missingMetaDescription: ['a', 'b', 'c'],
		badH1: [],
		thinContent: [],
		noindexPages: [],
		canonicalMismatch: [],
		redirectedPages: [],
		slowPages: [],
	},
	next_step: 'x',
};

test('Site Audit > Run: page URLs split into an array, simplified counts', async () => {
	const { calls, out } = await runOp(
		{
			resource: 'siteAudit',
			operation: 'run',
			options: { urls: 'https://example.com/, https://example.com/a\nhttps://example.com/b' },
			simplify: true,
		},
		auditResult,
	);
	expectCall(calls[0], 'site_audit', {
		urls: ['https://example.com/', 'https://example.com/a', 'https://example.com/b'],
	});
	assert.equal(Object.keys(out[0].json).length, 10);
	assert.equal(out[0].json.pagesFailed, 1);
	assert.equal(out[0].json.brokenInternalLinks, 2);
	assert.equal(out[0].json.missingMetaDescription, 3);
});

test('Site Audit > Run: number of pages maps to limit; raw output', async () => {
	const { calls, out } = await runOp(
		{ resource: 'siteAudit', operation: 'run', options: { pageCount: 10 }, simplify: false },
		auditResult,
	);
	expectCall(calls[0], 'site_audit', { limit: 10 });
	assert.deepEqual(out[0].json, auditResult);
});

test('Site Audit > Run: more than 30 URLs is refused before any request', async () => {
	const urls = Array.from({ length: 31 }, (_, i) => `https://example.com/${i}`).join(',');
	const h = makeExec({
		params: { resource: 'siteAudit', operation: 'run', options: { urls }, simplify: true },
		respond: () => assert.fail('no request expected'),
	});
	await expectThrows(h.run(), (e) => {
		assert.ok(e instanceof NodeOperationError);
		assert.match(e.message, /Too many page URLs: 31/);
		assert.equal(e.context.itemIndex, 0);
	});
});

test('Site Audit > Analyze Page: analyze_page_seo, simplified issues by severity', async () => {
	const { calls, out } = await runOp(
		{
			resource: 'siteAudit',
			operation: 'analyzePage',
			url: 'https://example.com/a',
			simplify: true,
		},
		{
			url: 'https://example.com/a',
			score: 72,
			issues: [
				{ severity: 'critical', category: 'Meta', message: 'Missing title' },
				{ severity: 'warning', category: 'Content', message: 'Thin content' },
				{ severity: 'info', category: 'Links', message: 'Few links' },
			],
			summary: { title: null, metaDescription: 'd', h1Count: 1, wordCount: 200, loadTimeMs: 900 },
		},
	);
	expectCall(calls[0], 'analyze_page_seo', { url: 'https://example.com/a' });
	assert.deepEqual(out[0].json.criticalIssues, ['Missing title']);
	assert.deepEqual(out[0].json.warnings, ['Thin content']);
	assert.equal(out[0].json.issueCount, 3);
	assert.equal(Object.keys(out[0].json).length, 10);
});

// ----- AI Visibility -------------------------------------------------------------------------

const visibilityResult = {
	scan: {
		id: UUID,
		domain: 'example.com',
		brand: 'Example',
		completedAt: '2026-09-20',
		promptsChecked: 3,
		perEngine: [
			{ engine: 'ChatGPT', visibilityPct: 40, mentions: 2 },
			{ engine: 'Gemini', visibilityPct: 20, mentions: 1 },
		],
		topCompetitors: [{ name: 'Rival', count: 4 }],
		missedPrompts: [{ prompt: 'best tool', missedOnEngines: ['gemini'], winners: ['Rival'] }],
	},
	recentScans: [],
	next_step: 'Each missed prompt is a gap.',
};

test('AI Visibility > Get: scan id sent, simplified report', async () => {
	const { calls, out } = await runOp(
		{ resource: 'aiVisibility', operation: 'get', options: { scanId: UUID }, simplify: true },
		visibilityResult,
	);
	expectCall(calls[0], 'get_ai_visibility', { scanId: UUID });
	const json = out[0].json;
	assert.equal(json.averageVisibilityPct, 30);
	assert.deepEqual(json.topCompetitors, ['Rival']);
	assert.deepEqual(json.missedPrompts, ['best tool']);
	assert.ok(Object.keys(json).length <= 10);
});

test('AI Visibility > Get: no scan yet, and an invalid scan ID is refused', async () => {
	const none = await runOp(
		{ resource: 'aiVisibility', operation: 'get', options: {}, simplify: true },
		{ scan: null, recentScans: [], note: 'No completed scan yet' },
	);
	expectCall(none.calls[0], 'get_ai_visibility', {});
	assert.equal(none.out[0].json.scanId, null);
	const h = makeExec({
		params: {
			resource: 'aiVisibility',
			operation: 'get',
			options: { scanId: 'nope' },
			simplify: true,
		},
		respond: () => assert.fail('no request expected'),
	});
	await expectThrows(h.run(), (e) => assert.match(e.message, /Scan ID/));
});

test('AI Visibility > Run Scan: competitor domain, payment required becomes an error', async () => {
	const ok = await runOp(
		{ resource: 'aiVisibility', operation: 'runScan', options: { domain: ' rival.com ' } },
		{ scanId: UUID, status: 'processing', domain: 'rival.com', estimatedCredits: 100 },
	);
	expectCall(ok.calls[0], 'run_ai_visibility_scan', { domain: 'rival.com' });
	assert.equal(ok.out[0].json.status, 'processing');

	const h = makeExec({
		params: { resource: 'aiVisibility', operation: 'runScan', options: {} },
		respond: () =>
			toolOk('run_ai_visibility_scan', {
				status: 'payment_required',
				message: 'Not enough AI credits for a fresh scan',
				price_per_scan: '$19',
				agentic_payment: { mpp_payment_link: 'https://app.seomatic.ai/pay/x' },
			}),
	});
	await expectThrows(h.run(), (e) => {
		assert.ok(e instanceof NodeOperationError);
		assert.equal(e.message, 'Not enough AI credits for a fresh scan');
		assert.match(e.description, /\$19/);
		assert.match(e.description, /https:\/\/app\.seomatic\.ai\/pay\/x/);
	});
	expectCall(h.calls[0], 'run_ai_visibility_scan', {});
});

// ----- Tracked Prompt ----------------------------------------------------------------------

const promptsResult = {
	monitor: { domain: 'example.com' },
	prompts: [
		{ id: UUID, text: 'best invoicing software', active: true, pinned: false, source: 'user' },
		{ id: UUID2, text: 'cheap invoicing', active: false, pinned: false, source: 'auto' },
	],
	limits: { maxActivePrompts: 10 },
};

test('Tracked Prompt > Create: add_tracked_prompt, locale sent only as a pair', async () => {
	const added = { id: UUID, text: 'best invoicing software' };
	const pair = await runOp(
		{
			resource: 'trackedPrompt',
			operation: 'create',
			prompt: ' best invoicing software ',
			options: { languageCode: 'en', locationCode: 2840 },
		},
		{ added, note: 'Tracked from the next scan onward.' },
	);
	expectCall(pair.calls[0], 'add_tracked_prompt', {
		prompt: 'best invoicing software',
		languageCode: 'en',
		locationCode: 2840,
	});
	assert.deepEqual(pair.out[0].json, added);
	const half = await runOp(
		{
			resource: 'trackedPrompt',
			operation: 'create',
			prompt: 'x y z',
			options: { languageCode: 'fr' },
		},
		{ added },
	);
	expectCall(half.calls[0], 'add_tracked_prompt', { prompt: 'x y z' });
});

test('Tracked Prompt > Get Many: one item per prompt, limit applied', async () => {
	const limited = await runOp(
		{ resource: 'trackedPrompt', operation: 'getAll', options: {}, returnAll: false, limit: 1 },
		promptsResult,
	);
	expectCall(limited.calls[0], 'list_tracked_prompts', {});
	assert.equal(limited.out.length, 1);
	const all = await runOp(
		{ resource: 'trackedPrompt', operation: 'getAll', options: {}, returnAll: true },
		promptsResult,
	);
	assert.equal(all.out.length, 2);
	assert.equal(all.out[1].json.text, 'cheap invoicing');
});

test('Tracked Prompt > Update: only set fields are sent; empty update refused', async () => {
	const { calls, out } = await runOp(
		{
			resource: 'trackedPrompt',
			operation: 'update',
			promptId: { mode: 'id', value: UUID },
			updateFields: { text: ' new wording ', active: false },
		},
		{ updated: true },
	);
	expectCall(calls[0], 'update_tracked_prompt', {
		promptId: UUID,
		text: 'new wording',
		active: false,
	});
	assert.deepEqual(out[0].json, { id: UUID, updated: true });
	const h = makeExec({
		params: {
			resource: 'trackedPrompt',
			operation: 'update',
			promptId: { mode: 'id', value: UUID },
			updateFields: {},
		},
		respond: () => assert.fail('no request expected'),
	});
	await expectThrows(h.run(), (e) => assert.equal(e.message, 'Nothing to update'));
});

test('Tracked Prompt > Delete: returns {"deleted": true}', async () => {
	const { calls, out } = await runOp(
		{ resource: 'trackedPrompt', operation: 'delete', promptId: { mode: 'list', value: UUID } },
		{ removed: true },
	);
	expectCall(calls[0], 'remove_tracked_prompt', { promptId: UUID });
	assert.deepEqual(
		out.map((o) => o.json),
		[{ deleted: true }],
	);
});

// ----- SEO Task ----------------------------------------------------------------------------

const taskRow = {
	id: UUID,
	type: 'ctr_fix',
	target: 'https://example.com/a',
	title: 'Rewrite title',
	status: 'proposed',
	score: 80,
	canAutoExecute: true,
	campaignId: null,
	createdBy: 'agent',
	updatedAt: '2026-09-20',
	maturesAt: null,
	retryNotBefore: null,
};

test('SEO Task > Get: simplified and raw', async () => {
	const result = {
		task: { ...taskRow, rationale: 'Low CTR', impactEstimate: 12, attempts: 0 },
		recentActions: [],
		note: 'n',
	};
	const simple = await runOp(task('get', { simplify: true }), result);
	expectCall(simple.calls[0], 'get_seo_task', { taskId: UUID });
	assert.equal(Object.keys(simple.out[0].json).length, 10);
	assert.equal(simple.out[0].json.rationale, 'Low CTR');
	const raw = await runOp(task('get', { simplify: false }), result);
	assert.deepEqual(raw.out[0].json, result);
});

test('SEO Task > Get Many: filters and max tasks, one item per task', async () => {
	const { calls, out } = await runOp(
		{
			resource: 'seoTask',
			operation: 'getAll',
			maxTasks: 5,
			filters: { status: 'proposed', type: ' ctr_fix ' },
			simplify: true,
		},
		{ tasks: [taskRow, { ...taskRow, id: UUID2 }], note: 'n' },
	);
	expectCall(calls[0], 'list_seo_tasks', { status: 'proposed', type: 'ctr_fix', limit: 5 });
	assert.equal(out.length, 2);
	assert.equal(out[1].json.id, UUID2);
	assert.equal(Object.keys(out[0].json).length, 10);
	const raw = await runOp(
		{ resource: 'seoTask', operation: 'getAll', maxTasks: 20, filters: {}, simplify: false },
		{ tasks: [taskRow] },
	);
	expectCall(raw.calls[0], 'list_seo_tasks', { limit: 20 });
	assert.deepEqual(raw.out[0].json, taskRow);
});

test('SEO Task > Approve and Dismiss use decide_seo_task', async () => {
	const decided = { taskId: UUID, title: 't', status: 'approved', message: 'm' };
	const plain = await runOp(task('approve', { options: {} }), decided);
	expectCall(plain.calls[0], 'decide_seo_task', { taskId: UUID, decision: 'approve' });
	const confirmed = await runOp(
		task('approve', { options: { confirmDestructive: true } }),
		decided,
	);
	expectCall(confirmed.calls[0], 'decide_seo_task', {
		taskId: UUID,
		decision: 'approve',
		confirmDestructive: true,
	});
	assert.deepEqual(confirmed.out[0].json, decided);
	const dismissed = await runOp(task('dismiss'), { ...decided, status: 'dismissed' });
	expectCall(dismissed.calls[0], 'decide_seo_task', { taskId: UUID, decision: 'dismiss' });
});

test('SEO Task > Execute: review token and confirmation passed through', async () => {
	const { calls } = await runOp(
		task('execute', { options: { reviewToken: ' tok123 ', confirmDestructive: true } }),
		{ taskId: UUID, enqueued: true, consented: true },
	);
	expectCall(calls[0], 'execute_seo_task', {
		taskId: UUID,
		confirmDestructive: true,
		reviewToken: 'tok123',
	});
});

test('SEO Task > Roll Back: rollback_seo_task with force only when set', async () => {
	const forced = await runOp(task('rollback', { options: { force: true } }), { enqueued: true });
	expectCall(forced.calls[0], 'rollback_seo_task', { taskId: UUID, force: true });
	const plain = await runOp(task('rollback', { options: {} }), { enqueued: true });
	expectCall(plain.calls[0], 'rollback_seo_task', { taskId: UUID });
});

// ----- Article -----------------------------------------------------------------------------

test('Article > Generate: generate_article with the topic', async () => {
	const result = { article_id: UUID, status: 'queued', eta: 'a few minutes', balance_remaining: 2 };
	const { calls, out } = await runOp(
		{ resource: 'article', operation: 'generate', topic: ' trail running shoes ' },
		result,
	);
	expectCall(calls[0], 'generate_article', { topic: 'trail running shoes' });
	assert.deepEqual(out[0].json, result);
});

test('Article > Generate: empty balance becomes a clear error with the buy link', async () => {
	const h = makeExec({
		params: { resource: 'article', operation: 'generate', topic: 'shoes' },
		respond: () =>
			toolOk('generate_article', {
				status: 'payment_required',
				price_per_article: '$9',
				message: 'No prepaid articles remaining.',
				buy_url: 'https://app.seomatic.ai/dashboard/articles?src=mcp',
			}),
	});
	await expectThrows(h.run(), (e) => {
		assert.equal(e.message, 'No prepaid articles remaining.');
		assert.match(e.description, /\$9/);
		assert.match(e.description, /dashboard\/articles/);
	});
});

test('Article > Get: get_article by id, Simplify drops the HTML copy', async () => {
	const article = {
		id: UUID,
		topic: 'shoes',
		status: 'ready',
		title: 'Shoes',
		word_count: 1500,
		ai_search_score: 80,
		content_score: 75,
		featured_image_url: 'https://img',
		markdown: '# Shoes',
		html: '<h1>Shoes</h1>',
	};
	const simple = await runOp(
		{
			resource: 'article',
			operation: 'get',
			articleId: { mode: 'list', value: UUID },
			simplify: true,
		},
		article,
	);
	expectCall(simple.calls[0], 'get_article', { article_id: UUID });
	assert.equal(simple.out[0].json.html, undefined);
	assert.equal(simple.out[0].json.markdown, '# Shoes');
	assert.equal(Object.keys(simple.out[0].json).length, 10);
	const failed = await runOp(
		{
			resource: 'article',
			operation: 'get',
			articleId: { mode: 'id', value: UUID },
			simplify: false,
		},
		{ id: UUID, topic: 'shoes', status: 'failed', error: 'Generation failed' },
	);
	assert.equal(failed.out[0].json.status, 'failed', 'a failed article is data, not a refusal');
});

test('Article > Get Many: get_article without id, one item per article', async () => {
	const { calls, out } = await runOp(
		{ resource: 'article', operation: 'getAll', returnAll: true },
		{
			balance: 3,
			articles: [
				{ id: UUID, topic: 'a' },
				{ id: UUID2, topic: 'b' },
			],
		},
	);
	expectCall(calls[0], 'get_article', {});
	assert.equal(out.length, 2);
});

// ----- errors, continueOnFail, safety --------------------------------------------------------

test('Tool refusal in the result becomes NodeOperationError with the connect link', async () => {
	const h = makeExec({
		params: sp('getMonthlyTrend'),
		respond: () =>
			toolOk('get_seasonality_baseline', {
				error: 'Search Console not connected.',
				connect_url: 'https://app.seomatic.ai/connect/gsc',
				next_step: 'If a show_connect_card tool is available, call it.',
			}),
	});
	await expectThrows(h.run(), (e) => {
		assert.ok(e instanceof NodeOperationError);
		assert.equal(e.message, 'Search Console not connected.');
		assert.equal(
			e.description,
			'Connect it at https://app.seomatic.ai/connect/gsc, then run the node again.',
		);
		assert.equal(e.context.itemIndex, 0);
	});
});

test('HTTP 402 (acting needs Infrastructure) becomes a clear NodeApiError', async () => {
	const h = makeExec({
		params: task('approve', { options: {} }),
		respond: () => {
			throw httpFail(402, {
				error: 'Acting through the REST API requires the Infrastructure plan.',
				code: 'REST_ACT_REQUIRES_INFRA',
				upgrade_url: 'https://app.seomatic.ai/settings/billing?src=api',
			});
		},
	});
	await expectThrows(h.run(), (e) => {
		assert.ok(e instanceof NodeApiError);
		assert.equal(e.message, 'This operation needs the SEOmatic Infrastructure plan');
		assert.match(e.description, /settings\/billing/);
		assert.equal(String(e.httpCode), '402');
		assert.equal(e.context.itemIndex, 0);
	});
});

test('HTTP 404 unknown tool explains why the operation is hidden', async () => {
	const h = makeExec({
		params: sp('getQueries', { limit: 5, options: {} }),
		respond: () => {
			throw httpFail(404, {
				error: 'Unknown or unauthorized tool: get_search_queries',
				code: 'UNKNOWN_TOOL',
			});
		},
	});
	await expectThrows(h.run(), (e) => {
		assert.equal(e.message, 'This operation is not available for this API key');
		assert.match(e.description, /Google Search Console/);
	});
});

test('HTTP 401 from an unwrapped error and free quota 402', async () => {
	const unauthorized = makeExec({
		params: sp('getMonthlyTrend'),
		respond: () => {
			throw new AxiosError(401, { error: 'Missing or invalid API key', code: 'INVALID_API_KEY' });
		},
	});
	await expectThrows(unauthorized.run(), (e) => {
		assert.ok(e instanceof NodeApiError);
		assert.equal(e.message, 'SEOmatic did not accept the API key');
		assert.match(e.description, /API keys/);
	});
	const quota = makeExec({
		params: sp('getMonthlyTrend'),
		respond: () => {
			throw httpFail(402, { error: 'Free monthly limit reached', code: 'FREE_QUOTA_EXCEEDED' });
		},
	});
	await expectThrows(quota.run(), (e) =>
		assert.equal(e.message, 'The free monthly question allowance is used up'),
	);
});

test('continueOnFail: failed item returns error json, next item still runs, pairing kept', async () => {
	const h = makeExec({
		items: [{ json: {} }, { json: {} }],
		params: [
			{ resource: 'article', operation: 'generate', topic: 'first' },
			{ resource: 'article', operation: 'generate', topic: 'second' },
		],
		continueOnFail: true,
		respond: (req) => {
			if (req.body.topic === 'first')
				throw httpFail(502, {
					error: "Tool 'generate_article' failed",
					code: 'TOOL_FAILED',
					details: 'boom',
				});
			return toolOk('generate_article', { article_id: UUID, status: 'queued' });
		},
	});
	const [out] = await h.run();
	assert.equal(out.length, 2);
	assert.equal(out[0].json.error, "Tool 'generate_article' failed");
	assert.match(out[0].json.description, /boom/);
	assert.deepEqual(out[0].pairedItem, { item: 0 });
	assert.equal(out[1].json.status, 'queued');
	assert.deepEqual(out[1].pairedItem, { item: 1 });
});

test('Without continueOnFail the error carries the failing item index', async () => {
	const h = makeExec({
		items: [{ json: {} }, { json: {} }],
		params: [
			{ resource: 'article', operation: 'generate', topic: 'ok' },
			{ resource: 'article', operation: 'generate', topic: 'bad' },
		],
		respond: (req) => {
			if (req.body.topic === 'bad')
				throw httpFail(400, {
					error: 'Invalid arguments for this tool',
					code: 'INVALID_ARGUMENTS',
					details: 'topic too short',
				});
			return toolOk('generate_article', { article_id: UUID, status: 'queued' });
		},
	});
	await expectThrows(h.run(), (e) => {
		assert.equal(e.context.itemIndex, 1);
		assert.match(e.description, /topic too short/);
	});
});

test('Every request goes to https://app.seomatic.ai with the SEOmatic credential', async () => {
	const all = [];
	const cases = [
		sp('getQueries', { limit: 1, options: {} }),
		sp('checkIndexing', { url: 'https://example.com/', simplify: false }),
		{ resource: 'siteAudit', operation: 'run', options: {}, simplify: false },
		{ resource: 'aiVisibility', operation: 'get', options: {}, simplify: false },
		{ resource: 'article', operation: 'getAll', returnAll: true },
		task('get', { simplify: false }),
	];
	for (const params of cases) {
		const { calls } = await runOp(params, { ok: true, task: {} });
		all.push(...calls);
	}
	for (const call of all) {
		assert.ok(call.url.startsWith(`${BASE}/api/v1/tools/`), call.url);
		assert.equal(call.credentialType, 'seomaticApi');
		assert.equal(call.headers, undefined, 'no hand-built auth headers');
	}
});

// ----- list search -------------------------------------------------------------------------

test('List search: tasks, tracked prompts, articles', async () => {
	const node = new Seomatic();
	const calls = [];
	const ctx = {
		getNode: () => NODE,
		helpers: {
			async httpRequestWithAuthentication(cred, req) {
				calls.push(req);
				const tool = req.url.split('/').pop();
				if (tool === 'list_seo_tasks')
					return toolOk(tool, { tasks: [taskRow, { ...taskRow, id: UUID2, title: 'Fix meta' }] });
				if (tool === 'list_tracked_prompts') return toolOk(tool, promptsResult);
				if (tool === 'get_article')
					return toolOk(tool, {
						balance: 1,
						articles: [{ id: UUID, title: 'Shoes', status: 'ready' }],
					});
				throw new Error(`unexpected ${tool}`);
			},
		},
	};
	const tasks = await node.methods.listSearch.searchSeoTasks.call(ctx, 'meta');
	assert.deepEqual(calls[0].body, { limit: 20 });
	assert.deepEqual(
		tasks.results.map((r) => r.value),
		[UUID2],
	);
	const prompts = await node.methods.listSearch.searchTrackedPrompts.call(ctx);
	assert.equal(prompts.results[1].name, 'cheap invoicing (paused)');
	const articles = await node.methods.listSearch.searchArticles.call(ctx, 'sho');
	assert.deepEqual(articles.results, [{ name: 'Shoes (ready)', value: UUID }]);
	assert.deepEqual(calls[2].body, {});
});

// ----- trigger -----------------------------------------------------------------------------

const HOOK_URL = 'https://n8n.example.com/webhook/abc/webhook';

function makeHook({
	webhookUrl = HOOK_URL,
	events = ['task.awaiting_approval'],
	staticData = {},
	respond,
}) {
	const calls = [];
	const ctx = {
		getNode: () => ({
			...NODE,
			name: 'SEOmatic Trigger',
			type: 'n8n-nodes-seomatic.seomaticTrigger',
		}),
		getWorkflowStaticData: () => staticData,
		getNodeWebhookUrl: () => webhookUrl,
		getNodeParameter: (name, fallback) => (name === 'events' ? events : fallback),
		logger: { debug() {} },
		helpers: {
			async httpRequestWithAuthentication(cred, req) {
				calls.push({ cred, ...req });
				return await respond(req);
			},
		},
	};
	return { ctx, calls, staticData, methods: new SeomaticTrigger().webhookMethods.default };
}

test('Trigger description follows trigger conventions', () => {
	const d = new SeomaticTrigger().description;
	assert.equal(d.name, 'seomaticTrigger');
	assert.ok(d.displayName.includes('Trigger'));
	assert.deepEqual(d.inputs, []);
	assert.deepEqual(d.group, ['trigger']);
	const events = d.properties.find((p) => p.name === 'events').options.map((o) => o.value);
	// The exact WEBHOOK_EVENTS list in the SEOmatic app (lib/services/webhooks/webhook-service.ts).
	assert.deepEqual([...events].sort(), [
		'ai_visibility.scan_completed',
		'campaign.completed',
		'page.publish_failed',
		'page.published',
		'task.awaiting_approval',
		'task.completed',
	]);
});

test('Trigger create: registers the n8n URL and stores id and secret', async () => {
	const h = makeHook({
		respond: () => ({
			endpoint: { id: UUID, url: HOOK_URL, events: ['task.awaiting_approval'] },
			secret: 'whsec_abc',
		}),
	});
	assert.equal(await h.methods.create.call(h.ctx), true);
	assert.equal(h.calls[0].cred, 'seomaticApi');
	assert.equal(h.calls[0].method, 'POST');
	assert.equal(h.calls[0].url, `${BASE}/api/v1/webhooks`);
	assert.deepEqual(h.calls[0].body, { url: HOOK_URL, events: ['task.awaiting_approval'] });
	assert.deepEqual(h.staticData, { webhookId: UUID, webhookSecret: 'whsec_abc' });
});

test('Trigger create: refuses a non-https address and a plan refusal is explained', async () => {
	const http = makeHook({
		webhookUrl: 'http://localhost:5678/webhook/x',
		respond: () => assert.fail(),
	});
	await expectThrows(http.methods.create.call(http.ctx), (e) => assert.match(e.message, /https/));
	const plan = makeHook({
		respond: () => {
			throw httpFail(402, {
				error: 'Webhooks require the Infrastructure plan.',
				code: 'FEATURE_NOT_AVAILABLE',
				upgrade_url: 'https://app.seomatic.ai/settings/billing',
			});
		},
	});
	await expectThrows(plan.methods.create.call(plan.ctx), (e) => {
		assert.ok(e instanceof NodeApiError);
		assert.equal(e.message, 'Webhooks require the Infrastructure plan.');
		assert.match(e.description, /settings\/billing/);
	});
});

test('Trigger checkExists: none stored, match, changed events, removed upstream', async () => {
	const none = makeHook({ respond: () => assert.fail('no request expected') });
	assert.equal(await none.methods.checkExists.call(none.ctx), false);

	const endpoint = { id: UUID, url: HOOK_URL, events: ['task.awaiting_approval'] };
	const same = makeHook({
		staticData: { webhookId: UUID, webhookSecret: 's' },
		respond: () => ({ endpoints: [endpoint], available_events: [] }),
	});
	assert.equal(await same.methods.checkExists.call(same.ctx), true);
	assert.equal(same.calls[0].method, 'GET');
	assert.equal(same.calls[0].url, `${BASE}/api/v1/webhooks`);

	const changed = makeHook({
		events: ['task.awaiting_approval', 'task.completed'],
		staticData: { webhookId: UUID, webhookSecret: 's' },
		respond: (req) => (req.method === 'GET' ? { endpoints: [endpoint] } : { deleted: true }),
	});
	assert.equal(await changed.methods.checkExists.call(changed.ctx), false);
	assert.equal(changed.calls[1].method, 'DELETE');
	assert.equal(changed.calls[1].url, `${BASE}/api/v1/webhooks/${UUID}`);
	assert.deepEqual(changed.staticData, {});

	const gone = makeHook({
		staticData: { webhookId: UUID, webhookSecret: 's' },
		respond: () => ({ endpoints: [] }),
	});
	assert.equal(await gone.methods.checkExists.call(gone.ctx), false);
	assert.deepEqual(gone.staticData, {});
});

test('Trigger delete: removes the endpoint; an already-removed one is fine', async () => {
	const h = makeHook({
		staticData: { webhookId: UUID, webhookSecret: 's' },
		respond: () => ({ deleted: true }),
	});
	assert.equal(await h.methods.delete.call(h.ctx), true);
	assert.equal(h.calls[0].method, 'DELETE');
	assert.equal(h.calls[0].url, `${BASE}/api/v1/webhooks/${UUID}`);
	assert.deepEqual(h.staticData, {});
	const gone = makeHook({
		staticData: { webhookId: UUID, webhookSecret: 's' },
		respond: () => {
			throw httpFail(404, { error: 'Webhook not found' });
		},
	});
	assert.equal(await gone.methods.delete.call(gone.ctx), true);
	const broken = makeHook({
		staticData: { webhookId: UUID, webhookSecret: 's' },
		respond: () => {
			throw httpFail(500, { error: 'Failed to delete webhook' });
		},
	});
	await expectThrows(broken.methods.delete.call(broken.ctx), (e) =>
		assert.ok(e instanceof NodeApiError),
	);
});

/** SEOmatic's own signer (lib/services/webhooks/webhook-service.ts signPayloadWithTimestamp). */
function seomaticSign(secret, body, t, previous) {
	const sign = (k) => crypto.createHmac('sha256', k).update(`${t}.${body}`).digest('hex');
	const parts = [`t=${t}`, `v1=${sign(secret)}`];
	if (previous && previous !== secret) parts.push(`v1=${sign(previous)}`);
	return parts.join(',');
}

function makeWebhookCall({
	secret = 'whsec_abc',
	events = ['task.awaiting_approval'],
	body,
	signature,
}) {
	const raw = JSON.stringify(body);
	const response = { statusCode: 200, payload: undefined };
	const ctx = {
		getWorkflowStaticData: () => ({ webhookId: UUID, webhookSecret: secret }),
		getRequestObject: () => ({ rawBody: Buffer.from(raw), body }),
		getHeaderData: () => (signature ? { 'x-seomatic-signature': signature } : {}),
		getResponseObject: () => ({
			status(code) {
				response.statusCode = code;
				return this;
			},
			json(payload) {
				response.payload = payload;
				return this;
			},
		}),
		getBodyData: () => body,
		getNodeParameter: (name, fallback) => (name === 'events' ? events : fallback),
		helpers: { returnJsonArray: (items) => items.map((json) => ({ json })) },
	};
	return { ctx, raw, response, run: () => new SeomaticTrigger().webhook.call(ctx) };
}

test('Trigger webhook: a correctly signed event starts the workflow', async () => {
	const body = {
		event: 'task.awaiting_approval',
		workspace_id: 'ws',
		created_at: '2026-09-24T10:00:00Z',
		data: { task_id: UUID, type: 'ctr_fix', title: 'Rewrite title' },
	};
	const now = Math.floor(Date.now() / 1000);
	const signature = seomaticSign('whsec_abc', JSON.stringify(body), now);
	const h = makeWebhookCall({ body, signature });
	const result = await h.run();
	assert.deepEqual(result.workflowData, [[{ json: body }]]);
});

test('Trigger webhook: wrong secret, missing header, tampered body, stale timestamp are refused', async () => {
	const body = { event: 'task.completed', data: {} };
	const now = Math.floor(Date.now() / 1000);
	const cases = [
		{ signature: seomaticSign('whsec_other', JSON.stringify(body), now) },
		{ signature: undefined },
		{ signature: seomaticSign('whsec_abc', JSON.stringify({ ...body, data: { x: 1 } }), now) },
		{ signature: seomaticSign('whsec_abc', JSON.stringify(body), now - 600) },
		{ signature: 't=abc,v1=zz' },
	];
	for (const c of cases) {
		const h = makeWebhookCall({ body, signature: c.signature, events: ['task.completed'] });
		const result = await h.run();
		assert.deepEqual(result, { noWebhookResponse: true });
		assert.equal(h.response.statusCode, 401);
	}
});

test('Trigger webhook: secret rotation (two v1 values) and unselected events', async () => {
	const body = { event: 'page.published', data: { url: 'https://example.com/new' } };
	const now = Math.floor(Date.now() / 1000);
	const rotated = seomaticSign('whsec_new', JSON.stringify(body), now, 'whsec_abc');
	const h = makeWebhookCall({ body, signature: rotated, events: ['page.published'] });
	assert.deepEqual((await h.run()).workflowData, [[{ json: body }]]);
	const other = makeWebhookCall({
		body,
		signature: seomaticSign('whsec_abc', JSON.stringify(body), now),
		events: ['task.completed'],
	});
	assert.deepEqual(await other.run(), { webhookResponse: { received: true } });
});

test('verifySignature is constant-time safe on malformed input', () => {
	const now = 1_700_000_000;
	assert.equal(verifySignature('s', `t=${now},v1=abc`, '{}', now), false);
	assert.equal(verifySignature('s', '', '{}', now), false);
	assert.equal(verifySignature('s', seomaticSign('s', '{}', now), '{}', now), true);
});

// ----- run ---------------------------------------------------------------------------------

(async () => {
	for (const { name, fn } of tests) {
		try {
			await fn();
			passed++;
			process.stdout.write(`ok   ${name}\n`);
		} catch (error) {
			failures.push(name);
			process.stdout.write(`FAIL ${name}\n     ${error && error.stack ? error.stack : error}\n`);
		}
	}
	process.stdout.write(`\n${passed} passed, ${failures.length} failed\n`);
	process.exitCode = failures.length > 0 ? 1 : 0;
})();
