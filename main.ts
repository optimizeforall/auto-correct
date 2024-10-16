import { App, Editor, MarkdownView, Notice, Plugin, PluginSettingTab, Setting, requestUrl, Modal } from 'obsidian';

// Remember to rename these classes and interfaces!

interface AutoCorrectSettings {
	apiKey: string;
	keyboardLayout: 'QWERTY' | 'AZERTY' | 'DVORAK' | 'COLEMAK';
	model: 'gpt-3.5-turbo'| 'gpt-4o-mini';
}

const DEFAULT_SETTINGS: AutoCorrectSettings = {
	apiKey: '',
	keyboardLayout: 'QWERTY',
	model: 'gpt-3.5-turbo' // Default model
}

export default class AutoCorrectPlugin extends Plugin {
	settings: AutoCorrectSettings;
	statusBarItem: HTMLElement;

	async onload() {
		await this.loadSettings();

		// Add status bar item
		this.statusBarItem = this.addStatusBarItem();

		// Add commands for auto-correction
		this.addCommand({
			id: 'auto-correct-file',
			name: 'Auto-correct entire file',
			hotkeys: [{ modifiers: ["Ctrl"], key: "'" }],
			editorCallback: (editor: Editor) => this.autoCorrectText(editor, false)
		});

		this.addCommand({
			id: 'auto-correct-selection',
			name: 'Auto-correct selected text',
			hotkeys: [{ modifiers: ["Ctrl", "Shift"], key: "'" }],
			editorCallback: (editor: Editor) => this.autoCorrectText(editor, true)
		});

		// Add settings tab
		this.addSettingTab(new AutoCorrectSettingTab(this.app, this));
	}

	async autoCorrectText(editor: Editor, selectionOnly: boolean) {
		const text = selectionOnly ? editor.getSelection() : editor.getValue();
		const wordCount = text.split(/\s+/).length;

		if (!text) {
			new Notice("No text to correct");
			return;
		}

		const scope = selectionOnly ? "selection" : "file";
		const processingMessage = `Processing ${scope} (${wordCount} words), please wait...`;
		
		// Show both Notice and status bar update
		new Notice(processingMessage);
		this.updateStatusBar(processingMessage);

		try {
			const { corrected, changes } = await this.callLLMForCorrection(text);
			if (selectionOnly) {
				editor.replaceSelection(corrected);
			} else {
				editor.setValue(corrected);
			}
			const successMessage = `${scope.charAt(0).toUpperCase() + scope.slice(1)} auto-corrected successfully!`;
			new Notice(successMessage);
			this.updateStatusBar(successMessage);
			
			// Display changes in a modal
			new ChangesModal(this.app, changes).open();
		} catch (error) {
			const errorMessage = "Error during auto-correction. Please check your API key and try again.";
			new Notice(errorMessage);
			this.updateStatusBar(errorMessage);
		}
	}

	updateStatusBar(message: string) {
		this.statusBarItem.setText(message);
		// Clear the status bar after 5 seconds
		setTimeout(() => {
			this.statusBarItem.setText('');
		}, 5000);
	}

	async callLLMForCorrection(text: string): Promise<{ corrected: string, changes: string }> {
		const apiKey = this.settings.apiKey;
		const prompt = `Correct the grammar, syntax, and spelling for this markdown text in obsidian, keep links, and other .md syntax. Assume a ${this.settings.keyboardLayout} keyboard layout for inferring nearby keys. Do not make major changes. Return the corrected text, followed by "---CHANGES---", then a numbered list of all changes made using the format "Before" to "After" (be careful and check you are displaying a real change):

"${text}"`;

		try {
			const response = await requestUrl({
				url: 'https://api.openai.com/v1/chat/completions',
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Authorization': `Bearer ${apiKey}`
				},
				body: JSON.stringify({
					model: this.settings.model,
					messages: [{"role": "user", "content": prompt}],
					temperature: 0.1
				})
			});

			if (response.status !== 200) {
				throw new Error(`API request failed with status ${response.status}`);
			}

			const responseContent = response.json.choices[0].message.content;
			const [corrected, changes] = responseContent.split('---CHANGES---');

			return { corrected: corrected.trim(), changes: changes.trim() };
		} catch (error) {
			console.error('Error calling OpenAI API:', error);
			throw error;
		}
	}

	onunload() {

	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class AutoCorrectSettingTab extends PluginSettingTab {
	plugin: AutoCorrectPlugin;

	constructor(app: App, plugin: AutoCorrectPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName('OpenAI API Key')
			.addText(text => text
					.setPlaceholder('Enter API key')
					.setValue(this.plugin.settings.apiKey)
					.onChange(async (value) => {
						this.plugin.settings.apiKey = value;
						await this.plugin.saveSettings();
					}));

		new Setting(containerEl)
			.setName('Keyboard Layout')
			.setDesc('Select your keyboard layout for better autocorrection')
			.addDropdown(dropdown => dropdown
				.addOptions({
					'QWERTY': 'QWERTY',
					'AZERTY': 'AZERTY',
					'DVORAK': 'DVORAK',
					'COLEMAK': 'COLEMAK'
				})
				.setValue(this.plugin.settings.keyboardLayout)
				.onChange(async (value) => {
					this.plugin.settings.keyboardLayout = value as AutoCorrectSettings['keyboardLayout'];
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Select Model')
			.setDesc('Choose the OpenAI model for auto-correction')
			.addDropdown(dropdown => dropdown
				.addOptions({
					'gpt-3.5-turbo': 'GPT-3.5 Turbo',
					'gpt-3.5-turbo-instruct': 'GPT-3.5 Turbo Instruct',
					'gpt-4o-mini': 'GPT-4o Mini'
				})
				.setValue(this.plugin.settings.model)
				.onChange(async (value) => {
					this.plugin.settings.model = value as AutoCorrectSettings['model'];
					await this.plugin.saveSettings();
				}));
	}
}

class ChangesModal extends Modal {
	changes: string;

	constructor(app: App, changes: string) {
		super(app);
		this.changes = changes;
	}

	onOpen() {
		const {contentEl} = this;
		contentEl.setText('Changes Made:');
		contentEl.createEl('pre', {text: this.changes});
		
		contentEl.createEl('p', {text: 'You can undo these changes with Ctrl+Z (Cmd+Z on Mac).'});
	}

	onClose() {
		const {contentEl} = this;
		contentEl.empty();
	}
}
