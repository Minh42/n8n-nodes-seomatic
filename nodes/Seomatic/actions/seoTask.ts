import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { callTool, compact, UNAVAILABLE_HINTS } from '../GenericFunctions';
import { idLocator, simplifyProperty, unsupported } from './common';

const show = (operation: string[]) => ({ resource: ['seoTask'], operation });

/** Task statuses exactly as SEOmatic's list tool accepts them. */
const TASK_STATUSES: Array<{ name: string; value: string; description: string }> = [
	{ name: 'Approved', value: 'approved', description: 'Approved and waiting to run' },
	{ name: 'Completed', value: 'completed', description: 'Advice delivered' },
	{ name: 'Dismissed', value: 'dismissed', description: 'Dismissed and archived' },
	{ name: 'Done', value: 'done', description: 'Finished' },
	{ name: 'In Progress', value: 'in_progress', description: 'Running now' },
	{ name: 'Inconclusive', value: 'inconclusive', description: 'Measured, no clear result' },
	{ name: 'Ineffective', value: 'ineffective', description: 'Measured, no improvement' },
	{ name: 'Obsolete', value: 'obsolete', description: 'No longer relevant' },
	{ name: 'Proposed', value: 'proposed', description: 'Waiting for your approval' },
	{ name: 'Regressed', value: 'regressed', description: 'Measured, results got worse' },
	{ name: 'Verified', value: 'verified', description: 'Measured, results improved' },
	{ name: 'Verifying', value: 'verifying', description: 'Applied, results are being measured' },
];

const confirmDestructive: INodeProperties = {
	displayName: 'Confirm Noindex or Redirect',
	name: 'confirmDestructive',
	type: 'boolean',
	default: false,
	description:
		'Whether a person has reviewed this exact page and agreed to the change. Required for tasks that hide a page from Google (noindex) or redirect it, which are quick to apply and take weeks to undo.',
};

export const seoTaskOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['seoTask'] } },
		options: [
			{
				name: 'Approve',
				value: 'approve',
				action: 'Approve SEO task',
				description:
					"Approve a task the SEO agent proposed so it runs through the agent's safety checks. Running a task uses AI credits.",
			},
			{
				name: 'Dismiss',
				value: 'dismiss',
				action: 'Dismiss SEO task',
				description: 'Dismiss a proposed task and archive it',
			},
			{
				name: 'Execute',
				value: 'execute',
				action: 'Execute SEO task',
				description:
					'Run an approved task now, or release a change the agent held for your review. Uses AI credits.',
			},
			{
				name: 'Get',
				value: 'get',
				action: 'Get SEO task',
				description: 'Retrieve one task with its reasoning, expected impact, and latest activity',
			},
			{
				name: 'Get Many',
				value: 'getAll',
				action: 'Get many SEO tasks',
				description: "Retrieve a list of tasks on the SEO agent's board",
			},
			{
				name: 'Roll Back',
				value: 'rollback',
				action: 'Roll back SEO task',
				description: "Undo a task's live change by restoring the page as it was before the edit",
			},
		],
		default: 'getAll',
	},
	{
		displayName:
			"SEO tasks need an API key created with 'Allow this key to make changes', the SEO agent turned on in SEOmatic, and the Infrastructure plan.",
		name: 'seoTaskNotice',
		type: 'notice',
		default: '',
		displayOptions: { show: { resource: ['seoTask'] } },
	},

	// Get / Approve / Dismiss / Execute / Roll Back
	idLocator({
		displayName: 'Task',
		name: 'taskId',
		searchListMethod: 'searchSeoTasks',
		description: 'The SEO task to use',
		placeholder: 'e.g. 3f1c2a9e-5b7d-4e8f-9a0b-1c2d3e4f5a6b',
		show: show(['get', 'approve', 'dismiss', 'execute', 'rollback']),
	}),

	// Approve
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: { show: show(['approve']) },
		options: [confirmDestructive],
	},

	// Execute
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: { show: show(['execute']) },
		options: [
			confirmDestructive,
			{
				displayName: 'Review Token',
				name: 'reviewToken',
				type: 'string',
				typeOptions: { password: true },
				default: '',
				description:
					"Releases a change the agent held for review (a first full-page rewrite or a protected page). Copy it from 'stagedReview.reviewToken' in the raw output of 'Get', and only after a person approved the held content itself.",
			},
		],
	},

	// Roll Back
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: { show: show(['rollback']) },
		options: [
			{
				displayName: 'Overwrite Newer Edits',
				name: 'force',
				type: 'boolean',
				default: false,
				description:
					'Whether to undo even if someone edited the page after the agent did. Their newer edit is lost, so turn this on only after they agreed.',
			},
		],
	},

	// Get Many
	{
		displayName: 'Max Tasks',
		name: 'maxTasks',
		type: 'number',
		typeOptions: { minValue: 1, maxValue: 20 },
		default: 15,
		displayOptions: { show: show(['getAll']) },
		description:
			'How many tasks to return, highest priority first. SEOmatic returns at most 20 tasks per request.',
	},
	{
		displayName: 'Filters',
		name: 'filters',
		type: 'collection',
		placeholder: 'Add Filter',
		default: {},
		displayOptions: { show: show(['getAll']) },
		options: [
			{
				displayName: 'Status',
				name: 'status',
				type: 'options',
				options: TASK_STATUSES,
				default: 'proposed',
				description: 'Only return tasks with this status',
			},
			{
				displayName: 'Type',
				name: 'type',
				type: 'string',
				default: '',
				placeholder: 'e.g. ctr_fix',
				description: 'Only return tasks of this type, as shown in the task data',
			},
		],
	},
	{
		...simplifyProperty,
		displayOptions: { show: show(['get', 'getAll']) },
	},
];

/** The ten task fields people act on, flattened. */
function simplifyTask(task: IDataObject): IDataObject {
	return {
		id: task.id,
		title: task.title,
		status: task.status,
		type: task.type,
		target: task.target,
		score: task.score,
		rationale: task.rationale ?? null,
		impactEstimate: task.impactEstimate ?? null,
		maturesAt: task.maturesAt ?? null,
		updatedAt: task.updatedAt ?? null,
	};
}

export async function executeSeoTask(
	this: IExecuteFunctions,
	operation: string,
	itemIndex: number,
): Promise<IDataObject[]> {
	const run = async (tool: string, args: IDataObject) =>
		await callTool.call(this, tool, args, { itemIndex, unavailableHint: UNAVAILABLE_HINTS.agent });
	const taskId = () =>
		this.getNodeParameter('taskId', itemIndex, undefined, { extractValue: true }) as string;
	const options = () => this.getNodeParameter('options', itemIndex, {}) as IDataObject;
	const simplify = () => this.getNodeParameter('simplify', itemIndex, true) as boolean;

	switch (operation) {
		case 'get': {
			const output = await run('get_seo_task', { taskId: taskId() });
			if (!simplify()) return [output];
			return [simplifyTask((output.task as IDataObject | undefined) ?? {})];
		}
		case 'getAll': {
			const filters = compact(this.getNodeParameter('filters', itemIndex, {}) as IDataObject);
			if (typeof filters.type === 'string') filters.type = filters.type.trim();
			const output = await run('list_seo_tasks', {
				...compact(filters),
				limit: this.getNodeParameter('maxTasks', itemIndex) as number,
			});
			const tasks = (output.tasks as IDataObject[] | undefined) ?? [];
			return tasks.map((task) => (simplify() ? simplifyTask(task) : { ...task }));
		}
		case 'approve':
		case 'dismiss': {
			const args: IDataObject = { taskId: taskId(), decision: operation };
			if (operation === 'approve' && options().confirmDestructive === true) {
				args.confirmDestructive = true;
			}
			return [await run('decide_seo_task', args)];
		}
		case 'execute': {
			const opts = options();
			const args: IDataObject = { taskId: taskId() };
			if (opts.confirmDestructive === true) args.confirmDestructive = true;
			if (typeof opts.reviewToken === 'string' && opts.reviewToken.trim()) {
				args.reviewToken = opts.reviewToken.trim();
			}
			return [await run('execute_seo_task', args)];
		}
		case 'rollback': {
			const args: IDataObject = { taskId: taskId() };
			if (options().force === true) args.force = true;
			return [await run('rollback_seo_task', args)];
		}
		default:
			return unsupported.call(this, operation, itemIndex);
	}
}
