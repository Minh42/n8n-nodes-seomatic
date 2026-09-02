import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	ILoadOptionsFunctions,
	INodePropertyOptions,
} from 'n8n-workflow';
import { NodeConnectionType } from 'n8n-workflow';

const BASE_URL = 'https://app.seomatic.ai';

/**
 * SEOmatic node: a thin, honest wrapper over the REST v1 tool bridge
 * (POST /api/v1/tools/{name}). The tool list is DYNAMIC - loaded from
 * GET /api/v1/tools with the user's own key, so the node always shows
 * exactly the tools that key can run (free insight tools on free keys,
 * agent actions on paid keys) and never goes stale as SEOmatic grows.
 */
export class Seomatic implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'SEOmatic',
		name: 'seomatic',
		icon: 'file:seomatic.svg',
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["tool"]}}',
		description:
			'AI SEO over your own Google Search Console data: performance, striking-distance keywords, audits, cannibalization, seasonality - plus approval-gated agent actions on paid plans.',
		defaults: { name: 'SEOmatic' },
		inputs: [NodeConnectionType.Main],
		outputs: [NodeConnectionType.Main],
		credentials: [{ name: 'seomaticApi', required: true }],
		properties: [
			{
				displayName: 'Tool Name or ID',
				name: 'tool',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getTools' },
				default: '',
				required: true,
				description:
					'The SEOmatic tool to run. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
			{
				displayName: 'Arguments (JSON)',
				name: 'args',
				type: 'json',
				default: '{}',
				description:
					'Tool arguments as JSON, e.g. {"days": 28, "limit": 50}. Each tool\'s parameters are documented at https://seomatic.ai/developers/api.',
			},
		],
	};

	methods = {
		loadOptions: {
			async getTools(
				this: ILoadOptionsFunctions,
			): Promise<INodePropertyOptions[]> {
				const response = (await this.helpers.httpRequestWithAuthentication.call(
					this,
					'seomaticApi',
					{ method: 'GET', url: `${BASE_URL}/api/v1/tools`, json: true },
				)) as { tools?: Array<{ name: string; description?: string }> };
				return (response.tools ?? []).map((t) => ({
					name: t.name,
					value: t.name,
					description: (t.description ?? '').slice(0, 200),
				}));
			},
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const out: INodeExecutionData[] = [];
		for (let i = 0; i < items.length; i++) {
			const tool = this.getNodeParameter('tool', i) as string;
			const rawArgs = this.getNodeParameter('args', i, '{}');
			const args =
				typeof rawArgs === 'string' ? JSON.parse(rawArgs || '{}') : rawArgs;
			const response = await this.helpers.httpRequestWithAuthentication.call(
				this,
				'seomaticApi',
				{
					method: 'POST',
					url: `${BASE_URL}/api/v1/tools/${encodeURIComponent(tool)}`,
					body: args,
					json: true,
				},
			);
			out.push({ json: response as Record<string, unknown>, pairedItem: i });
		}
		return [out];
	}
}
