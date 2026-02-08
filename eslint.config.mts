import tseslint from 'typescript-eslint';
import obsidianmd from "eslint-plugin-obsidianmd";
import comments from "@eslint-community/eslint-plugin-eslint-comments/configs";
import globals from "globals";
import { globalIgnores } from "eslint/config";

export default tseslint.config(
	{
		languageOptions: {
			globals: {
				...globals.browser,
				createDiv: 'readonly',
				createSpan: 'readonly',
				createEl: 'readonly',
			},
			parserOptions: {
				projectService: {
					allowDefaultProject: [
						'eslint.config.js',
						'manifest.json'
					]
				},
				tsconfigRootDir: import.meta.dirname,
				extraFileExtensions: ['.json']
			},
		},
	},
	...obsidianmd.configs.recommended,
	comments.recommended,
	{
		rules: {
			'@eslint-community/eslint-comments/require-description': 'error',
			'@eslint-community/eslint-comments/no-unlimited-disable': 'error',
			'@eslint-community/eslint-comments/no-unused-disable': 'error',
		},
	},
	globalIgnores([
		"node_modules",
		"dist",
		"esbuild.config.mjs",
		"eslint.config.js",
		"version-bump.mjs",
		"versions.json",
		"main.js",
	]),
);
