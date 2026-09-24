import type { IDisplayOptions, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

/** SEOmatic ids are UUIDs. */
export const UUID_REGEX =
	'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';

export const simplifyProperty: INodeProperties = {
	displayName: 'Simplify',
	name: 'simplify',
	type: 'boolean',
	default: true,
	description: 'Whether to return a simplified version of the response instead of the raw data',
};

/** Resource locator with "From list" first, plus a pasted ID. */
export function idLocator(options: {
	displayName: string;
	name: string;
	searchListMethod: string;
	description: string;
	placeholder: string;
	show: NonNullable<IDisplayOptions['show']>;
}): INodeProperties {
	return {
		displayName: options.displayName,
		name: options.name,
		type: 'resourceLocator',
		default: { mode: 'list', value: '' },
		required: true,
		description: options.description,
		displayOptions: { show: options.show },
		modes: [
			{
				displayName: 'From List',
				name: 'list',
				type: 'list',
				typeOptions: { searchListMethod: options.searchListMethod, searchable: true },
			},
			{
				displayName: 'ID',
				name: 'id',
				type: 'string',
				placeholder: options.placeholder,
				validation: [
					{
						type: 'regex',
						properties: { regex: UUID_REGEX, errorMessage: 'Not a valid SEOmatic ID' },
					},
				],
			},
		],
	};
}

export function unsupported(this: IExecuteFunctions, operation: string, itemIndex: number): never {
	throw new NodeOperationError(this.getNode(), `The operation "${operation}" is not supported`, {
		itemIndex,
	});
}
