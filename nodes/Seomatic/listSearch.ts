import type {
	IDataObject,
	ILoadOptionsFunctions,
	INodeListSearchItems,
	INodeListSearchResult,
} from 'n8n-workflow';
import { callTool, UNAVAILABLE_HINTS } from './GenericFunctions';

const APP_URL = 'https://app.seomatic.ai';

function matches(filter: string | undefined, ...values: unknown[]): boolean {
	if (!filter) return true;
	const needle = filter.toLowerCase();
	return values.some((value) => typeof value === 'string' && value.toLowerCase().includes(needle));
}

function toResults(items: INodeListSearchItems[]): INodeListSearchResult {
	return { results: items };
}

export async function searchSeoTasks(
	this: ILoadOptionsFunctions,
	filter?: string,
): Promise<INodeListSearchResult> {
	const output = await callTool.call(
		this,
		'list_seo_tasks',
		{ limit: 20 },
		{
			unavailableHint: UNAVAILABLE_HINTS.agent,
		},
	);
	const tasks = (output.tasks as IDataObject[] | undefined) ?? [];
	return toResults(
		tasks
			.filter((task) => matches(filter, task.title, task.type, task.target, task.status))
			.map((task) => ({
				name: `${String(task.title ?? task.id)} (${String(task.status ?? '')})`,
				value: String(task.id),
				url: `${APP_URL}/dashboard/agents`,
			})),
	);
}

export async function searchTrackedPrompts(
	this: ILoadOptionsFunctions,
	filter?: string,
): Promise<INodeListSearchResult> {
	const output = await callTool.call(
		this,
		'list_tracked_prompts',
		{},
		{
			unavailableHint: UNAVAILABLE_HINTS.changes,
		},
	);
	const prompts = (output.prompts as IDataObject[] | undefined) ?? [];
	return toResults(
		prompts
			.filter((prompt) => matches(filter, prompt.text))
			.map((prompt) => ({
				name: `${String(prompt.text ?? prompt.id)}${prompt.active === false ? ' (paused)' : ''}`,
				value: String(prompt.id),
			})),
	);
}

export async function searchArticles(
	this: ILoadOptionsFunctions,
	filter?: string,
): Promise<INodeListSearchResult> {
	const output = await callTool.call(
		this,
		'get_article',
		{},
		{
			unavailableHint: UNAVAILABLE_HINTS.general,
		},
	);
	const articles = (output.articles as IDataObject[] | undefined) ?? [];
	return toResults(
		articles
			.filter((article) => matches(filter, article.title, article.topic))
			.map((article) => ({
				name: `${String(article.title ?? article.topic ?? article.id)} (${String(article.status ?? '')})`,
				value: String(article.id),
			})),
	);
}
