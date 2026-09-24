import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import { callTool, compact, UNAVAILABLE_HINTS } from '../GenericFunctions';
import { idLocator, unsupported } from './common';

const show = (operation: string[]) => ({ resource: ['trackedPrompt'], operation });

const localeOptions: INodeProperties[] = [
	{
		displayName: 'Language Code',
		name: 'languageCode',
		type: 'string',
		default: '',
		placeholder: 'e.g. en',
		description:
			"Language of the AI visibility monitor to use. Set it together with 'Location Code'; leave both empty for your main monitor.",
	},
	{
		displayName: 'Location Code',
		name: 'locationCode',
		type: 'number',
		default: 0,
		placeholder: 'e.g. 2840',
		description:
			"Location of the AI visibility monitor to use, as a numeric location code (2840 is the United States). Set it together with 'Language Code'; leave both empty for your main monitor.",
	},
];

export const trackedPromptOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['trackedPrompt'] } },
		options: [
			{
				name: 'Create',
				value: 'create',
				action: 'Create tracked prompt',
				description:
					'Add a question that future AI visibility scans ask every AI engine. Free to add; each active prompt adds to the cost of every scan.',
			},
			{
				name: 'Delete',
				value: 'delete',
				action: 'Delete tracked prompt',
				description: 'Delete a tracked prompt permanently. Past scan results for it are kept.',
			},
			{
				name: 'Get Many',
				value: 'getAll',
				action: 'Get many tracked prompts',
				description: 'Retrieve a list of the prompts your AI visibility monitor tracks',
			},
			{
				name: 'Update',
				value: 'update',
				action: 'Update tracked prompt',
				description: 'Change the text of a tracked prompt, pin it, or pause and resume it',
			},
		],
		default: 'create',
	},
	{
		displayName:
			"Tracked prompts need an API key created with 'Allow this key to make changes' and the SEOmatic Infrastructure plan.",
		name: 'trackedPromptNotice',
		type: 'notice',
		default: '',
		displayOptions: { show: { resource: ['trackedPrompt'] } },
	},

	// Create
	{
		displayName: 'Prompt',
		name: 'prompt',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g. best invoicing software for freelancers',
		displayOptions: { show: show(['create']) },
		description:
			'The question to track, written the way a customer would ask an AI assistant (3 to 300 characters)',
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

	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: { show: show(['create', 'getAll']) },
		options: localeOptions,
	},

	// Update / Delete
	idLocator({
		displayName: 'Tracked Prompt',
		name: 'promptId',
		searchListMethod: 'searchTrackedPrompts',
		description: 'The tracked prompt to change',
		placeholder: 'e.g. 3f1c2a9e-5b7d-4e8f-9a0b-1c2d3e4f5a6b',
		show: show(['update', 'delete']),
	}),
	{
		displayName: 'Update Fields',
		name: 'updateFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: { show: show(['update']) },
		options: [
			{
				displayName: 'Active',
				name: 'active',
				type: 'boolean',
				default: true,
				description:
					'Whether scans keep asking this prompt. Paused prompts keep their history; resuming checks your plan limit again.',
			},
			{
				displayName: 'Pinned',
				name: 'pinned',
				type: 'boolean',
				default: false,
				description: 'Whether to pin this prompt in SEOmatic',
			},
			{
				displayName: 'Prompt',
				name: 'text',
				type: 'string',
				default: '',
				placeholder: 'e.g. best invoicing software for freelancers',
				description: 'New wording for the prompt (3 to 300 characters)',
			},
		],
	},
];

/** Both locale fields must be set for SEOmatic to use them, so send them only as a pair. */
function localeArgs(options: IDataObject): IDataObject {
	const languageCode = typeof options.languageCode === 'string' ? options.languageCode.trim() : '';
	const locationCode = Number(options.locationCode);
	return languageCode && Number.isInteger(locationCode) && locationCode > 0
		? { languageCode, locationCode }
		: {};
}

export async function executeTrackedPrompt(
	this: IExecuteFunctions,
	operation: string,
	itemIndex: number,
): Promise<IDataObject[]> {
	const run = async (tool: string, args: IDataObject) =>
		await callTool.call(this, tool, args, {
			itemIndex,
			unavailableHint: UNAVAILABLE_HINTS.changes,
		});
	const promptId = () =>
		this.getNodeParameter('promptId', itemIndex, undefined, { extractValue: true }) as string;

	switch (operation) {
		case 'create': {
			const options = this.getNodeParameter('options', itemIndex, {}) as IDataObject;
			const output = await run('add_tracked_prompt', {
				prompt: (this.getNodeParameter('prompt', itemIndex) as string).trim(),
				...localeArgs(options),
			});
			return [(output.added as IDataObject | undefined) ?? output];
		}
		case 'getAll': {
			const options = this.getNodeParameter('options', itemIndex, {}) as IDataObject;
			const output = await run('list_tracked_prompts', localeArgs(options));
			const prompts = ((output.prompts as IDataObject[] | undefined) ?? []).map((prompt) => ({
				...prompt,
			}));
			const returnAll = this.getNodeParameter('returnAll', itemIndex, false) as boolean;
			if (returnAll) return prompts;
			return prompts.slice(0, this.getNodeParameter('limit', itemIndex, 50) as number);
		}
		case 'update': {
			const fields = compact(this.getNodeParameter('updateFields', itemIndex, {}) as IDataObject);
			if (typeof fields.text === 'string') fields.text = fields.text.trim();
			if (Object.keys(compact(fields)).length === 0) {
				throw new NodeOperationError(this.getNode(), 'Nothing to update', {
					itemIndex,
					description: "Add at least one field under 'Update Fields'.",
				});
			}
			const id = promptId();
			await run('update_tracked_prompt', { promptId: id, ...compact(fields) });
			return [{ id, updated: true }];
		}
		case 'delete': {
			await run('remove_tracked_prompt', { promptId: promptId() });
			return [{ deleted: true }];
		}
		default:
			return unsupported.call(this, operation, itemIndex);
	}
}
