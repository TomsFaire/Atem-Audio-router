const { combineRgb } = require('@companion-module/base')

module.exports = {
	initPresets: function () {
		let presets = []

		const white = combineRgb(255, 255, 255)
		const black = combineRgb(0, 0, 0)
		const green = combineRgb(0, 180, 0)

		// Create preset recall buttons for each saved preset
		for (const preset of this.STATE.presets) {
			presets.push({
				type: 'button',
				category: 'Preset Recall',
				name: preset.name,
				style: {
					text: preset.name,
					size: '14',
					color: white,
					bgcolor: black,
				},
				steps: [
					{
						down: [
							{
								actionId: 'recallPreset',
								options: {
									name: preset.name,
								},
							},
						],
						up: [],
					},
				],
				feedbacks: [
					{
						feedbackId: 'presetActive',
						options: {
							name: preset.name,
						},
						style: {
							color: white,
							bgcolor: green,
						},
					},
				],
			})
		}

		// Status display button
		presets.push({
			type: 'button',
			category: 'Status',
			name: 'Connection Status',
			style: {
				text: 'ATEM\\n$(atem-audiorouter:connection_status)',
				size: '14',
				color: white,
				bgcolor: black,
			},
			steps: [
				{
					down: [],
					up: [],
				},
			],
			feedbacks: [],
		})

		this.setPresetDefinitions(presets)
	},
}
