module.exports = {
	initVariables: function () {
		let variables = []

		variables.push({ variableId: 'connection_status', name: 'Connection Status' })
		variables.push({ variableId: 'atem_connected', name: 'ATEM Connected' })
		variables.push({ variableId: 'source_count', name: 'Source Count' })
		variables.push({ variableId: 'output_count', name: 'Output Count' })

		// Dynamic variables for each output's current source
		for (const output of this.STATE.outputs) {
			const safeId = String(output.id).replace(/[^a-zA-Z0-9]/g, '_')
			variables.push({
				variableId: `output_${safeId}_source`,
				name: `${output.name} - Current Source`,
			})
		}

		this.setVariableDefinitions(variables)
	},

	checkVariables: function () {
		try {
			const values = {
				connection_status: this.STATE.connected ? 'Connected' : 'Disconnected',
				atem_connected: this.STATE.connected ? 'True' : 'False',
				source_count: String(this.STATE.sources.length),
				output_count: String(this.STATE.outputs.length),
			}

			// Set current source name for each output
			for (const output of this.STATE.outputs) {
				const safeId = String(output.id).replace(/[^a-zA-Z0-9]/g, '_')
				const source = this.STATE.sources.find((s) => s.id === output.sourceId)
				values[`output_${safeId}_source`] = source ? source.name : 'None'
			}

			this.setVariableValues(values)
		} catch (error) {
			this.log('error', 'Error setting variables: ' + String(error))
		}
	},
}
