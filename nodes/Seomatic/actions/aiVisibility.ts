import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import { callTool, compact, UNAVAILABLE_HINTS } from '../GenericFunctions';
import { simplifyProperty, unsupported, UUID_REGEX } from './common';

const show = (operation: string[]) => ({ resource: ['aiVisibility'], operation });

export const aiVisibilityOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['aiVisibility'] } },
		options: [
			{
				name: 'Get',
				value: 'get',
				action: 'Get AI visibility report',
				description:
					'Retrieve the latest AI visibility scan: how often ChatGPT, Claude, Gemini, Perplexity, and other AI engines mention your brand. Free: reads a stored scan and never starts a new one.',
			},
			{
				name: 'Run Scan',
				value: 'runScan',
				action: 'Run AI visibility scan',
				description:
					'Start a new AI visibility scan of your site or a competitor. Uses AI credits. Needs a key allowed to make changes and the Infrastructure plan.',
			},
		],
		default: 'get',
	},

	// Get
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: { show: show(['get']) },
		options: [
			{
				displayName: 'Scan ID',
				name: 'scanId',
				type: 'string',
				default: '',
				placeholder: 'e.g. 3f1c2a9e-5b7d-4e8f-9a0b-1c2d3e4f5a6b',
				description:
					"A specific scan to read, for example the ID returned by 'Run Scan'. Leave empty for the latest completed scan.",
			},
		],
	},
	{
		...simplifyProperty,
		displayOptions: { show: show(['get']) },
	},

	// Run Scan
	{
		displayName:
			"Starting a scan uses AI credits from your SEOmatic workspace. If the credits can't cover it, the scan is refused: workflows never spend prepaid scans. It needs an API key created with 'Allow this key to make changes' and the Infrastructure plan, and is limited to one scan per hour.",
		name: 'runScanNotice',
		type: 'notice',
		default: '',
		displayOptions: { show: show(['runScan']) },
	},
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: { show: show(['runScan']) },
		options: [
			{
				displayName: 'Competitor Domain',
				name: 'domain',
				type: 'string',
				default: '',
				placeholder: 'e.g. competitor.com',
				description:
					'Scan this competitor instead of your own site. Leave empty to scan your site.',
			},
		],
	},
];

/** The report people act on: scan facts, per-engine visibility, and the prompts the brand missed. */
function simplifyReport(output: IDataObject): IDataObject {
	const scan = output.scan as IDataObject | null | undefined;
	if (!scan) {
		return { scanId: null, note: output.note ?? null, recentScans: output.recentScans ?? [] };
	}
	const engines = (Array.isArray(scan.perEngine) ? scan.perEngine : []) as IDataObject[];
	const competitors = (
		Array.isArray(scan.topCompetitors) ? scan.topCompetitors : []
	) as IDataObject[];
	const missed = (Array.isArray(scan.missedPrompts) ? scan.missedPrompts : []) as IDataObject[];
	const visibility = engines
		.map((engine) => Number(engine.visibilityPct))
		.filter((value) => Number.isFinite(value));
	return {
		scanId: scan.id,
		domain: scan.domain,
		brand: scan.brand ?? null,
		completedAt: scan.completedAt ?? null,
		promptsChecked: scan.promptsChecked ?? null,
		averageVisibilityPct:
			visibility.length > 0
				? Math.round(visibility.reduce((sum, value) => sum + value, 0) / visibility.length)
				: null,
		engines: engines.map((engine) => ({
			engine: engine.engine,
			visibilityPct: engine.visibilityPct,
		})),
		topCompetitors: competitors.map((competitor) => competitor.name),
		missedPrompts: missed.map((prompt) => prompt.prompt),
		nextStep: output.next_step ?? null,
	};
}

export async function executeAiVisibility(
	this: IExecuteFunctions,
	operation: string,
	itemIndex: number,
): Promise<IDataObject[]> {
	const options = this.getNodeParameter('options', itemIndex, {}) as IDataObject;

	switch (operation) {
		case 'get': {
			const scanId = typeof options.scanId === 'string' ? options.scanId.trim() : '';
			if (scanId && !new RegExp(UUID_REGEX).test(scanId)) {
				throw new NodeOperationError(this.getNode(), `The value in 'Scan ID' is not a valid ID`, {
					itemIndex,
					description: "Use the scan ID returned by 'Run Scan', or leave 'Scan ID' empty.",
				});
			}
			const output = await callTool.call(this, 'get_ai_visibility', compact({ scanId }), {
				itemIndex,
				unavailableHint: UNAVAILABLE_HINTS.general,
			});
			const simplify = this.getNodeParameter('simplify', itemIndex, true) as boolean;
			return [simplify ? simplifyReport(output) : output];
		}
		case 'runScan': {
			const domain = typeof options.domain === 'string' ? options.domain.trim() : '';
			return [
				await callTool.call(this, 'run_ai_visibility_scan', compact({ domain }), {
					itemIndex,
					unavailableHint: UNAVAILABLE_HINTS.changes,
				}),
			];
		}
		default:
			return unsupported.call(this, operation, itemIndex);
	}
}
