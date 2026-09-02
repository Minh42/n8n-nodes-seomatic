import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class SeomaticApi implements ICredentialType {
	name = 'seomaticApi';

	displayName = 'SEOmatic API';

	documentationUrl = 'https://seomatic.ai/developers';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			description:
				'Create one in SEOmatic under Settings > Integrations > API Keys (starts with smk_)',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.apiKey}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: 'https://app.seomatic.ai',
			url: '/api/v1/me',
		},
	};
}
