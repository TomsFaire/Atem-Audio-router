module.exports = {
	initActions: function () {
		let self = this
		let actions = {}

		// Build dropdown choices from cached state
		const outputChoices = self.STATE.outputs.map((o) => ({
			id: o.id,
			label: o.name,
		}))

		const sourceChoices = self.STATE.sources.map((s) => ({
			id: s.id,
			label: s.name,
		}))

		const presetChoices = self.STATE.presets.map((p) => ({
			id: p.name,
			label: p.name,
		}))

		actions.setRoute = {
			name: 'Set Audio Route',
			description: 'Route an audio source to an output',
			options: [
				{
					type: 'dropdown',
					label: 'Output',
					id: 'outputId',
					default: outputChoices.length > 0 ? outputChoices[0].id : 0,
					choices: outputChoices,
				},
				{
					type: 'dropdown',
					label: 'Source',
					id: 'sourceId',
					default: sourceChoices.length > 0 ? sourceChoices[0].id : 0,
					choices: sourceChoices,
				},
			],
			callback: async (action) => {
				self.sendCommand('setRoute', {
					outputId: action.options.outputId,
					sourceId: action.options.sourceId,
				})
			},
		}

		actions.recallPreset = {
			name: 'Recall Preset',
			description: 'Recall a saved audio routing preset',
			options: [
				{
					type: 'dropdown',
					label: 'Preset',
					id: 'name',
					default: presetChoices.length > 0 ? presetChoices[0].id : '',
					choices: presetChoices.length > 0 ? presetChoices : [{ id: '', label: '(no presets)' }],
				},
			],
			callback: async (action) => {
				if (action.options.name) {
					self.sendCommand('recallPreset', { name: action.options.name })
				}
			},
		}

		actions.savePreset = {
			name: 'Save Preset',
			description: 'Save current audio routing as a preset',
			options: [
				{
					type: 'textinput',
					label: 'Preset Name',
					id: 'name',
					default: '',
					useVariables: true,
				},
			],
			callback: async (action) => {
				let name = await self.parseVariablesInString(action.options.name)
				if (name) {
					self.sendCommand('savePreset', { name })
				}
			},
		}

		this.setActionDefinitions(actions)
	},
}
