import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { callTool, UNAVAILABLE_HINTS } from '../GenericFunctions';
import { idLocator, simplifyProperty, unsupported } from './common';

const show = (operation: string[]) => ({ resource: ['article'], operation });

export const articleOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['article'] } },
		options: [
			{
				name: 'Generate',
				value: 'generate',
				action: 'Generate article',
				description:
					'Order one in-depth SEO article on a topic. Costs $9, paid from your prepaid article balance. No subscription needed.',
			},
			{
				name: 'Get',
				value: 'get',
				action: 'Get article',
				description: 'Retrieve an article with its status and, once ready, its content',
			},
			{
				name: 'Get Many',
				value: 'getAll',
				action: 'Get many articles',
				description: 'Retrieve a list of your 20 most recent pay-as-you-go articles',
			},
		],
		default: 'generate',
	},

	// Generate
	{
		displayName:
			'Each article costs $9 and uses one unit of your prepaid article balance. Writing takes a few minutes: use the returned article ID with the Get operation until the status is "ready".',
		name: 'generateNotice',
		type: 'notice',
		default: '',
		displayOptions: { show: show(['generate']) },
	},
	{
		displayName: 'Topic',
		name: 'topic',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g. how to choose trail running shoes',
		displayOptions: { show: show(['generate']) },
		description: 'The keyword or subject to write about (3 to 500 characters)',
	},

	// Get
	idLocator({
		displayName: 'Article',
		name: 'articleId',
		searchListMethod: 'searchArticles',
		description: 'The article to retrieve',
		placeholder: 'e.g. 3f1c2a9e-5b7d-4e8f-9a0b-1c2d3e4f5a6b',
		show: show(['get']),
	}),
	{
		...simplifyProperty,
		displayOptions: { show: show(['get']) },
	},

	// Get Many
	{
		displayName: 'Return All',
		name: 'returnAll',
		type: 'boolean',
		default: false,
		displayOptions: { show: show(['getAll']) },
		description: 'Whether to return all results or only up to a given limit',
	},
	{
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		typeOptions: { minValue: 1 },
		default: 50,
		displayOptions: { show: { ...show(['getAll']), returnAll: [false] } },
		description: 'Max number of results to return',
	},
];

/** Everything except the HTML copy, which duplicates the markdown. */
function simplifyArticle(article: IDataObject): IDataObject {
	return {
		id: article.id,
		status: article.status,
		topic: article.topic,
		title: article.title ?? null,
		word_count: article.word_count ?? null,
		ai_search_score: article.ai_search_score ?? null,
		content_score: article.content_score ?? null,
		featured_image_url: article.featured_image_url ?? null,
		markdown: article.markdown ?? null,
		error: article.error ?? null,
	};
}

export async function executeArticle(
	this: IExecuteFunctions,
	operation: string,
	itemIndex: number,
): Promise<IDataObject[]> {
	const run = async (args: IDataObject, tool = 'get_article') =>
		await callTool.call(this, tool, args, {
			itemIndex,
			unavailableHint: UNAVAILABLE_HINTS.general,
		});

	switch (operation) {
		case 'generate': {
			const topic = (this.getNodeParameter('topic', itemIndex) as string).trim();
			return [await run({ topic }, 'generate_article')];
		}
		case 'get': {
			const articleId = this.getNodeParameter('articleId', itemIndex, undefined, {
				extractValue: true,
			}) as string;
			const output = await run({ article_id: articleId });
			const simplify = this.getNodeParameter('simplify', itemIndex, true) as boolean;
			return [simplify ? simplifyArticle(output) : output];
		}
		case 'getAll': {
			const output = await run({});
			const articles = ((output.articles as IDataObject[] | undefined) ?? []).map((article) => ({
				...article,
			}));
			const returnAll = this.getNodeParameter('returnAll', itemIndex, false) as boolean;
			if (returnAll) return articles;
			return articles.slice(0, this.getNodeParameter('limit', itemIndex, 50) as number);
		}
		default:
			return unsupported.call(this, operation, itemIndex);
	}
}
