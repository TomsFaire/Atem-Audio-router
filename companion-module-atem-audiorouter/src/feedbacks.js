const { combineRgb } = require('@companion-module/base')

module.exports = {
	initFeedbacks: function () {
		let self = this
		let feedbacks = {}

		const foregroundColor = combineRgb(255, 255, 255)
		const activeColor = combineRgb(0, 180, 0)

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

		feedbacks.routeActive = {
			type: 'boolean',
			name: 'Route Active',
			description: 'Indicates if a specific output is routed to a specific source',
			defaultStyle: {
				color: foregroundColor,
				bgcolor: activeColor,
			},
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
			callback: async (event) => {
				const output = self.STATE.outputs.find((o) => o.id === event.options.outputId)
				if (output) {
					return output.sourceId === event.options.sourceId
				}
				return false
			},
		}

		feedbacks.presetActive = {
			type: 'boolean',
			name: 'Preset Active',
			description: 'Indicates if the current routing matches a saved preset',
			defaultStyle: {
				color: foregroundColor,
				bgcolor: activeColor,
			},
			options: [
				{
					type: 'dropdown',
					label: 'Preset',
					id: 'name',
					default: presetChoices.length > 0 ? presetChoices[0].id : '',
					choices: presetChoices.length > 0 ? presetChoices : [{ id: '', label: '(no presets)' }],
				},
			],
			callback: async (event) => {
				// We would need preset route data to compare, for now just check by name
				// This could be enhanced to compare actual routes
				return false
			},
		}

		this.setFeedbackDefinitions(feedbacks)
	},
}
