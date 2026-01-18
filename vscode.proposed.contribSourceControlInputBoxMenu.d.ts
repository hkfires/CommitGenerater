/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// https://github.com/microsoft/vscode/issues/195474

declare module 'vscode' {

	export interface SourceControlInputBoxValueProviderContext {
		readonly resourceGroupId: string;
		readonly resources: readonly Uri[];
	}

	export interface SourceControlInputBoxValueProvider {
		readonly label: string;
		readonly icon?: Uri | { light: Uri; dark: Uri } | ThemeIcon;
		provideValue(rootUri: Uri, context: SourceControlInputBoxValueProviderContext[], token: CancellationToken): ProviderResult<string | undefined>;
	}

	export namespace scm {
		export function registerSourceControlInputBoxValueProvider(sourceControlId: string, provider: SourceControlInputBoxValueProvider): Disposable;
	}
}
