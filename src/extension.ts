// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	console.log('Congratulations, your extension "paradox-script-formatter" is now active!');
	const formatter = vscode.languages.registerDocumentFormattingEditProvider('stellaris', {
		provideDocumentFormattingEdits(document: vscode.TextDocument): vscode.TextEdit[] {
			// This is where the actual formatting logic will go.
			// For now, let's just show a message and return no changes.
			vscode.window.showInformationMessage('Formatting Paradox file!');
			// Example of how to replace the entire document content.
			// const firstLine = document.lineAt(0);
			// const lastLine = document.lineAt(document.lineCount - 1);
			// const fullRange = new vscode.Range(firstLine.range.start, lastLine.range.end);
			// return [vscode.TextEdit.replace(fullRange, "New formatted content")];
			return []; // Return an empty array for no changes
		}
	});
	context.subscriptions.push(formatter);
}
// This method is called when your extension is deactivated
export function deactivate() {}
