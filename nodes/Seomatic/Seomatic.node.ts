import type {
	IDataObject,
	IExecuteFunctions,
	ILoadOptionsFunctions,
	INodeExecutionData,
	INodePropertyOptions,
	INodeType,
	INodeTypeDescription,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

const BASE_URL = 'https://app.seomatic.ai';

/**
 * SEOmatic node: a thin wrapper over the REST v1 tool bridge
 * (POST /api/v1/tools/{name}). The tool list is loaded from GET /api/v1/tools
 * with the user's own key, so the node always shows exactly the tools that
 * key can run (insight tools on free keys, agent actions on paid keys) and
 * never goes stale as SEOmatic adds tools.
 */
export class Seomatic implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'SEOmatic',
		name: 'seomatic',
		icon: { light: 'file:seomatic.svg', dark: 'file:seomatic.dark.svg' },
		group: ['transform'],
		version: [1],
		subtitle: '={{$parameter["tool"]}}',
		description:
			'Run SEOmatic SEO tools on your own Google Search Console data, plus approval-gated agent actions on paid plans',
		defaults: { name: 'SEOmatic' },
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		usableAsTool: true,
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
				displayName: 'Arguments',
				name: 'args',
				type: 'json',
				default: '{}',
				description:
					'The tool arguments as JSON, e.g. {"days": 28, "limit": 50}. Each tool lists its arguments at https://seomatic.ai/developers/rest-api.',
			},
		],
	};

	methods = {
		loadOptions: {
			async getTools(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const response = (await this.helpers.httpRequestWithAuthentication.call(
					this,
					'seomaticApi',
					{ method: 'GET', url: `${BASE_URL}/api/v1/tools`, json: true },
				)) as { tools?: Array<{ name: string; description?: string }> };
				return (response.tools ?? [])
					.map((t) => ({
						name: t.name,
						value: t.name,
						description: (t.description ?? '').slice(0, 200),
					}))
					.sort((a, b) => a.name.localeCompare(b.name));
			},
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const out: INodeExecutionData[] = [];

		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			const tool = this.getNodeParameter('tool', itemIndex) as string;
			const rawArgs = this.getNodeParameter('args', itemIndex, '{}');

			let args: IDataObject;
			try {
				args =
					typeof rawArgs === 'string'
						? (JSON.parse(rawArgs || '{}') as IDataObject)
						: (rawArgs as IDataObject);
			} catch {
				if (this.continueOnFail()) {
					out.push({
						json: { error: 'Arguments must be valid JSON' },
						pairedItem: { item: itemIndex },
					});
					continue;
				}
				throw new NodeOperationError(this.getNode(), 'Arguments must be valid JSON', {
					itemIndex,
				});
			}

			let response: IDataObject;
			try {
				response = (await this.helpers.httpRequestWithAuthentication.call(this, 'seomaticApi', {
					method: 'POST',
					url: `${BASE_URL}/api/v1/tools/${encodeURIComponent(tool)}`,
					body: args,
					json: true,
				})) as IDataObject;
			} catch (error) {
				if (this.continueOnFail()) {
					out.push({
						json: { error: (error as Error).message },
						pairedItem: { item: itemIndex },
					});
					continue;
				}
				throw new NodeApiError(this.getNode(), error as JsonObject, { itemIndex });
			}

			// The bridge answers {tool, result} where `result` is the tool's own
			// output as a JSON string. Parse it so the next node gets fields, not
			// an escaped string; keep the raw text if it is not JSON.
			const json: IDataObject = { ...response };
			if (typeof response.result === 'string') {
				try {
					json.result = JSON.parse(response.result) as IDataObject;
				} catch {
					json.result = response.result;
				}
			}
			out.push({ json, pairedItem: { item: itemIndex } });
		}
		return [out];
	}
}
