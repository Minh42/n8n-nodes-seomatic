import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import { callTool, toUrlList, UNAVAILABLE_HINTS } from '../GenericFunctions';
import { simplifyProperty, unsupported } from './common';

const MAX_PAGES = 30;

const show = (operation: string[]) => ({ resource: ['siteAudit'], operation });

export const siteAuditOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['siteAudit'] } },
		options: [
			{
				name: 'Analyze Page',
				value: 'analyzePage',
				action: 'Analyze page SEO',
				description: 'Score one page from 0 to 100 and list its SEO issues',
			},
			{
				name: 'Run',
				value: 'run',
				action: 'Run site audit',
				description:
					'Crawl up to 30 pages of your site and find issues across pages, such as duplicate titles, thin content, and broken links',
			},
		],
		default: 'run',
	},

	// Run
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: { show: show(['run']) },
		options: [
			{
				displayName: 'Number of Pages',
				name: 'pageCount',
				type: 'number',
				typeOptions: { minValue: 3, maxValue: MAX_PAGES },
				default: 20,
				description:
					"How many of your newest pages to crawl (3 to 30). Ignored when 'Page URLs' is set.",
			},
			{
				displayName: 'Page URLs',
				name: 'urls',
				type: 'string',
				default: '',
				placeholder: 'e.g. https://example.com/, https://example.com/pricing',
				description:
					'Specific pages to audit, separated by commas or new lines (up to 30). Leave empty to audit the newest pages SEOmatic knows about.',
			},
		],
	},

	// Analyze Page
	{
		displayName: 'Page URL',
		name: 'url',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g. https://example.com/blog/my-post',
		displayOptions: { show: show(['analyzePage']) },
		description: 'The full address of the page to analyze, starting with https://',
	},
	{
		...simplifyProperty,
		displayOptions: { show: show(['run', 'analyzePage']) },
	},
];

const count = (value: unknown): number => (Array.isArray(value) ? value.length : 0);

/** Site audit summary: how many pages have each issue. */
function simplifyAudit(output: IDataObject): IDataObject {
	const issues = (output.issues ?? {}) as IDataObject;
	return {
		pagesCrawled: output.pagesCrawled ?? 0,
		pagesFailed: count(output.pagesFailed),
		partial: output.partial ?? null,
		deadPages: count(issues.deadPages),
		brokenInternalLinks: count(issues.brokenInternalLinks),
		duplicateTitles: count(issues.duplicateTitles),
		duplicateMetaDescriptions: count(issues.duplicateMetaDescriptions),
		missingMetaDescription: count(issues.missingMetaDescription),
		thinContent: count(issues.thinContent),
		noindexPages: count(issues.noindexPages),
	};
}

/** One-page analysis: score, headline facts, and issue messages by severity. */
function simplifyPage(output: IDataObject): IDataObject {
	const summary = (output.summary ?? {}) as IDataObject;
	const issues = (Array.isArray(output.issues) ? output.issues : []) as IDataObject[];
	const messages = (severity: string) =>
		issues.filter((issue) => issue.severity === severity).map((issue) => issue.message);
	return {
		url: output.url,
		score: output.score,
		criticalIssues: messages('critical'),
		warnings: messages('warning'),
		issueCount: issues.length,
		title: summary.title ?? null,
		metaDescription: summary.metaDescription ?? null,
		wordCount: summary.wordCount ?? null,
		h1Count: summary.h1Count ?? null,
		loadTimeMs: summary.loadTimeMs ?? null,
	};
}

export async function executeSiteAudit(
	this: IExecuteFunctions,
	operation: string,
	itemIndex: number,
): Promise<IDataObject[]> {
	const simplify = this.getNodeParameter('simplify', itemIndex, true) as boolean;
	const hint = { itemIndex, unavailableHint: UNAVAILABLE_HINTS.general };

	switch (operation) {
		case 'run': {
			const options = this.getNodeParameter('options', itemIndex, {}) as IDataObject;
			const urls = toUrlList(options.urls);
			if (urls.length > MAX_PAGES) {
				throw new NodeOperationError(
					this.getNode(),
					`Too many page URLs: ${urls.length} given, 30 allowed`,
					{
						itemIndex,
						description:
							"Remove some addresses from 'Page URLs', or split the audit over several runs.",
					},
				);
			}
			const args: IDataObject = {};
			if (urls.length > 0) args.urls = urls;
			else if (options.pageCount !== undefined) args.limit = options.pageCount;
			const output = await callTool.call(this, 'site_audit', args, hint);
			return [simplify ? simplifyAudit(output) : output];
		}
		case 'analyzePage': {
			const output = await callTool.call(
				this,
				'analyze_page_seo',
				{ url: (this.getNodeParameter('url', itemIndex) as string).trim() },
				hint,
			);
			return [simplify ? simplifyPage(output) : output];
		}
		default:
			return unsupported.call(this, operation, itemIndex);
	}
}
