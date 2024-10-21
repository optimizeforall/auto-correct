	import { App, Editor, MarkdownView, Notice, Plugin, PluginSettingTab, Setting, requestUrl, Modal } from 'obsidian';

	// Remember to rename these classes and interfaces!

	interface AutoCorrectSettings {
		apiKey: string;
		keyboardLayout: 'QWERTY' | 'AZERTY' | 'DVORAK' | 'COLEMAK';
		model: 'gpt-3.5-turbo' | 'gpt-4o-mini';
	}

	const DEFAULT_SETTINGS: AutoCorrectSettings = {
		apiKey: '',
		keyboardLayout: 'QWERTY',
		model: 'gpt-3.5-turbo'
	}

	export default class AutoCorrectPlugin extends Plugin {
		settings: AutoCorrectSettings;
		statusBarItem: HTMLElement;
		private processingIndicator: ReturnType<typeof setInterval> | null = null; // Change type here

		async onload() {
			await this.loadSettings();

			// Add status bar item
			this.statusBarItem = this.addStatusBarItem();

			// Add commands for auto-correction
			this.addCommand({
				id: 'auto-correct-file',
				name: 'Auto-correct entire file',
				hotkeys: [{ modifiers: ["Ctrl"], key: "'" }], // Default hotkey
				editorCallback: (editor: Editor) => this.autoCorrectText(editor, false)
			});

			this.addCommand({
				id: 'auto-correct-selection',
				name: 'Auto-correct selected text',
				hotkeys: [{ modifiers: ["Ctrl", "Shift"], key: "'" }], // Default hotkey
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
			const processingMessage = `Processing ${scope} (${wordCount} words), using model: ${this.settings.model}, please wait...`;
			
			new Notice(processingMessage);
			this.updateStatusBar(processingMessage);
			this.startProcessingIndicator();

			const startTime = performance.now(); // Start timing

			try {
				const { corrected, changes } = await this.callLLMForCorrection(text);
				const endTime = performance.now(); // End timing
				const timeTaken = ((endTime - startTime) / 1000).toFixed(2); // Time in seconds

				if (selectionOnly) {
					editor.replaceSelection(corrected);
				} else {
					editor.setValue(corrected);
				}
				const successMessage = `${scope.charAt(0).toUpperCase() + scope.slice(1)} auto-corrected successfully in ${timeTaken} seconds!`;
				new Notice(successMessage);
				this.updateStatusBar(successMessage);
				
				new ChangesModal(this.app, changes, timeTaken).open(); // Pass time taken to modal
			} catch (error) {
				const errorMessage = "Error during auto-correction. Please check your API key and try again.";
				new Notice(errorMessage);
				this.updateStatusBar(errorMessage);
			} finally {
				this.stopProcessingIndicator();
			}
		}

		updateStatusBar(message: string) {
			this.statusBarItem.setText(message);
			// Clear the status bar after 5 seconds
			setTimeout(() => {
				this.statusBarItem.setText('');
			}, 5000);
		}

		startProcessingIndicator() {
			if (this.processingIndicator !== null) {
				clearInterval(this.processingIndicator);
			}
			let dots = 0;
			this.processingIndicator = setInterval(() => {
				dots = (dots + 1) % 4;
				this.statusBarItem.setText(`Processing${'.'.repeat(dots)}`);
			}, 500);
		}

		stopProcessingIndicator() {
			if (this.processingIndicator !== null) {
				clearInterval(this.processingIndicator);
				this.processingIndicator = null;
				this.statusBarItem.setText('');
			}
		}

		async callLLMForCorrection(text: string): Promise<{ corrected: string, changes: string }> {
			const apiKey = this.settings.apiKey;
			if (!apiKey) {
				throw new Error('API key is missing. Please set your OpenAI API key in the plugin settings.');
			}

			const prompt = `Correct the grammar, syntax, and spelling for this markdown text in Obsidian, keeping links and other .md syntax intact. Assume a ${this.settings.keyboardLayout} keyboard layout for inferring nearby keys. Do not make major changes. Return the corrected text as plain markdown without any code block formatting, followed by "---CHANGES---", then a numbered list of all changes made using the format "Before" to "After":

    "${text}"`;

			const maxRetries = 3;
			for (let attempt = 1; attempt <= maxRetries; attempt++) {
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
						throw new Error(`API request failed with status ${response.status}: ${response.json.error.message}`);
					}

					const responseContent = response.json.choices[0].message.content;
					const [corrected, changes] = responseContent.split('---CHANGES---');

					return { corrected: corrected.trim(), changes: changes.trim() };
				} catch (error) {
					console.error(`Attempt ${attempt} failed:`, error);
					if (attempt < maxRetries) {
						// Wait before retrying
						await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
					} else {
						throw new Error('Error during auto-correction after multiple attempts. Please try again later.');
					}
				}
			}
			return { corrected: '', changes: '' };
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
				.setDesc('Enter your OpenAI API key')
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
				.setName('Model')
				.setDesc('Choose the GPT model to use for auto-correction. Note: GPT-3.5 is faster, while GPT-4o Mini is smarter but slower.\n\nFor best performance, consider your needs: speed vs. accuracy.')
				.addDropdown(dropdown => dropdown
					.addOptions({
						'gpt-3.5-turbo': 'gpt-3.5-turbo',
						'gpt-4o-mini': 'gpt-4o-mini'
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
		timeTaken: string;

		constructor(app: App, changes: string, timeTaken: string) {
			super(app);
			this.changes = changes;
			this.timeTaken = timeTaken;
		}

		onOpen() {
			const {contentEl} = this;
			contentEl.setText('Changes Made:');
			contentEl.createEl('pre', {text: this.changes});
			contentEl.createEl('p', {text: `Time taken: ${this.timeTaken} seconds`}); // Display time taken
			contentEl.createEl('p', {text: 'You can undo these changes with Ctrl+Z (Cmd+Z on Mac).'});
		}

		onClose() {
			const {contentEl} = this;
			contentEl.empty();
		}
	}
