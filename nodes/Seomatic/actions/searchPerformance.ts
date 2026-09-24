import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { callTool, compact, UNAVAILABLE_HINTS } from '../GenericFunctions';
import { simplifyProperty, unsupported } from './common';

const show = (operation: string[]) => ({ resource: ['searchPerformance'], operation });

const daysOption = (max: number, min = 1): INodeProperties => ({
	displayName: 'Days',
	name: 'days',
	type: 'number',
	typeOptions: { minValue: min, maxValue: max },
	default: 28,
	description: `How many days of Google Search Console data to look at (${min} to ${max})`,
});

export const searchPerformanceOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['searchPerformance'] } },
		options: [
			{
				name: 'Check Indexing',
				value: 'checkIndexing',
				action: 'Check page indexing',
				description: 'Ask Google Search Console whether a page is indexed, and why not',
			},
			{
				name: 'Compare Periods',
				value: 'comparePeriods',
				action: 'Compare search performance periods',
				description:
					'Compare the latest period with the one before it and list the pages or searches that lost or gained the most clicks',
			},
			{
				name: 'Find Competing Pages',
				value: 'findCompetingPages',
				action: 'Find pages competing for the same search',
				description:
					'Find searches where two or more of your pages compete with each other and split the clicks',
			},
			{
				name: 'Find Low Click Rate Pages',
				value: 'findLowClickRatePages',
				action: 'Find pages with a low click rate',
				description:
					'Find pages that get far fewer clicks than their Google position should earn, usually fixed with a better title and description',
			},
			{
				name: 'Get Monthly Trend',
				value: 'getMonthlyTrend',
				action: 'Get monthly search trend',
				description:
					'Retrieve 16 months of monthly clicks with a year-over-year verdict on whether a drop is seasonal or real',
			},
			{
				name: 'Get Pages',
				value: 'getPages',
				action: 'Get top pages from search',
				description: 'Retrieve your pages that get the most clicks from Google search',
			},
			{
				name: 'Get Queries',
				value: 'getQueries',
				action: 'Get top search queries',
				description: 'Retrieve the searches people use to find your site in Google',
			},
		],
		default: 'getQueries',
	},

	// Get Queries / Get Pages
	{
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		typeOptions: { minValue: 1, maxValue: 1000 },
		default: 50,
		displayOptions: { show: show(['getQueries', 'getPages']) },
		description: 'Max number of results to return',
	},
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: { show: show(['getQueries', 'getPages']) },
		options: [daysOption(90)],
	},

	// Compare Periods
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: { show: show(['comparePeriods']) },
		options: [
			{
				displayName: 'Compare By',
				name: 'dimension',
				type: 'options',
				options: [
					{ name: 'Page', value: 'page' },
					{ name: 'Search Query', value: 'query' },
				],
				default: 'page',
				description: 'Whether to compare pages or search queries',
			},
			{
				...daysOption(45, 7),
				description:
					'Length of each period in days (7 to 45). The latest period is compared with the one right before it.',
			},
			{
				displayName: 'Rows Per Period',
				name: 'rowsPerPeriod',
				type: 'number',
				typeOptions: { minValue: 10, maxValue: 10000 },
				default: 500,
				description: 'How many top pages or queries to read from each period before comparing them',
			},
		],
	},

	// Find Competing Pages
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: { show: show(['findCompetingPages']) },
		options: [
			daysOption(90, 7),
			{
				displayName: 'Minimum Impressions',
				name: 'minImpressions',
				type: 'number',
				typeOptions: { minValue: 10 },
				default: 100,
				description: 'Ignore searches that were shown fewer times than this in Google',
			},
		],
	},

	// Find Low Click Rate Pages
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: { show: show(['findLowClickRatePages']) },
		options: [
			daysOption(90, 7),
			{
				displayName: 'Minimum Impressions',
				name: 'minImpressions',
				type: 'number',
				typeOptions: { minValue: 50 },
				default: 200,
				description: 'Only judge pages that were shown at least this many times in Google',
			},
		],
	},

	// Check Indexing
	{
		displayName: 'Page URL',
		name: 'url',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g. https://example.com/blog/my-post',
		displayOptions: { show: show(['checkIndexing']) },
		description: 'The full address of the page to check, starting with https://',
	},
	{
		...simplifyProperty,
		displayOptions: { show: show(['checkIndexing']) },
	},
];

/** Flatten the indexing report to the ten fields people act on. */
function simplifyIndexing(output: IDataObject): IDataObject {
	const indexing = (output.indexing ?? {}) as IDataObject;
	return {
		inspectedUrl: output.inspectedUrl,
		verdict: indexing.verdict ?? null,
		coverageState: indexing.coverageState ?? null,
		indexingState: indexing.indexingState ?? null,
		robotsTxtState: indexing.robotsTxtState ?? null,
		pageFetchState: indexing.pageFetchState ?? null,
		lastCrawlTime: indexing.lastCrawlTime ?? null,
		googleCanonical: indexing.googleCanonical ?? null,
		userCanonical: indexing.userCanonical ?? null,
		inspectionResultLink: output.inspectionResultLink ?? null,
	};
}

export async function executeSearchPerformance(
	this: IExecuteFunctions,
	operation: string,
	itemIndex: number,
): Promise<IDataObject[]> {
	const run = async (tool: string, args: IDataObject) =>
		await callTool.call(this, tool, args, {
			itemIndex,
			unavailableHint: UNAVAILABLE_HINTS.searchConsole,
		});
	const options = (): IDataObject => this.getNodeParameter('options', itemIndex, {}) as IDataObject;

	switch (operation) {
		case 'getQueries':
		case 'getPages': {
			const isQueries = operation === 'getQueries';
			const output = await run(isQueries ? 'get_search_queries' : 'get_top_pages', {
				...compact(options()),
				limit: this.getNodeParameter('limit', itemIndex) as number,
			});
			const rows = (isQueries ? output.queries : output.pages) as IDataObject[] | undefined;
			return (rows ?? []).map((row) => ({ ...row }));
		}
		case 'comparePeriods': {
			const { rowsPerPeriod, ...rest } = options();
			return [await run('compare_periods', compact({ ...rest, limit: rowsPerPeriod }))];
		}
		case 'findCompetingPages':
			return [await run('find_cannibalization', compact(options()))];
		case 'findLowClickRatePages':
			return [await run('find_ctr_outliers', compact(options()))];
		case 'getMonthlyTrend':
			return [await run('get_seasonality_baseline', {})];
		case 'checkIndexing': {
			const output = await run('inspect_url_indexing', {
				url: (this.getNodeParameter('url', itemIndex) as string).trim(),
			});
			const simplify = this.getNodeParameter('simplify', itemIndex, true) as boolean;
			return [simplify ? simplifyIndexing(output) : output];
		}
		default:
			return unsupported.call(this, operation, itemIndex);
	}
}
