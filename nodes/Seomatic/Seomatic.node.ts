import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { aiVisibilityOperations, executeAiVisibility } from './actions/aiVisibility';
import { articleOperations, executeArticle } from './actions/article';
import { executeSearchPerformance, searchPerformanceOperations } from './actions/searchPerformance';
import { executeSeoTask, seoTaskOperations } from './actions/seoTask';
import { executeSiteAudit, siteAuditOperations } from './actions/siteAudit';
import { executeTrackedPrompt, trackedPromptOperations } from './actions/trackedPrompt';
import { searchArticles, searchSeoTasks, searchTrackedPrompts } from './listSearch';

type ResourceHandler = (
	this: IExecuteFunctions,
	operation: string,
	itemIndex: number,
) => Promise<IDataObject[]>;

const handlers: Record<string, ResourceHandler> = {
	aiVisibility: executeAiVisibility,
	article: executeArticle,
	searchPerformance: executeSearchPerformance,
	seoTask: executeSeoTask,
	siteAudit: executeSiteAudit,
	trackedPrompt: executeTrackedPrompt,
};

export class Seomatic implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'SEOmatic',
		name: 'seomatic',
		icon: { light: 'file:seomatic.svg', dark: 'file:seomatic.dark.svg' },
		group: ['transform'],
		version: [2],
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description:
			'Read Google Search Console insights, audit pages, track AI visibility, and approve SEO agent tasks in SEOmatic',
		defaults: { name: 'SEOmatic' },
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		usableAsTool: true,
		credentials: [{ name: 'seomaticApi', required: true }],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'AI Visibility', value: 'aiVisibility' },
					{ name: 'Article', value: 'article' },
					{ name: 'Search Performance', value: 'searchPerformance' },
					{ name: 'SEO Task', value: 'seoTask' },
					{ name: 'Site Audit', value: 'siteAudit' },
					{ name: 'Tracked Prompt', value: 'trackedPrompt' },
				],
				default: 'searchPerformance',
			},
			...aiVisibilityOperations,
			...articleOperations,
			...searchPerformanceOperations,
			...seoTaskOperations,
			...siteAuditOperations,
			...trackedPromptOperations,
		],
	};

	methods = {
		listSearch: {
			searchArticles,
			searchSeoTasks,
			searchTrackedPrompts,
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			try {
				const resource = this.getNodeParameter('resource', itemIndex) as string;
				const operation = this.getNodeParameter('operation', itemIndex) as string;
				const handler = handlers[resource];
				if (!handler) {
					throw new NodeOperationError(
						this.getNode(),
						`The resource "${resource}" is not supported`,
						{ itemIndex },
					);
				}
				const results = await handler.call(this, operation, itemIndex);
				for (const json of results) {
					returnData.push({ json, pairedItem: { item: itemIndex } });
				}
			} catch (error) {
				if (this.continueOnFail()) {
					const description = (error as { description?: unknown }).description;
					returnData.push({
						json: {
							error: (error as Error).message,
							...(typeof description === 'string' && description ? { description } : {}),
						},
						pairedItem: { item: itemIndex },
					});
					continue;
				}
				const nodeError =
					error instanceof NodeApiError || error instanceof NodeOperationError
						? error
						: new NodeOperationError(this.getNode(), error as Error, { itemIndex });
				if (nodeError.context.itemIndex === undefined) nodeError.context.itemIndex = itemIndex;
				throw nodeError;
			}
		}

		return [returnData];
	}
}
