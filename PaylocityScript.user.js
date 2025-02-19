// ==UserScript==
// @name		Paylocity PTO helper
// @version		2.6
// @description	Make Paylocity easier to read
// @author		Mike Garrett
// @match		https://*.paylocity.com/*/employeeselfservice/*
// @updateURL	https://github.com/M-Garrett/MG-Browser-Scripts/raw/main/PaylocityScript.user.js
// @downloadURL	https://github.com/M-Garrett/MG-Browser-Scripts/raw/main/PaylocityScript.user.js
// @grant		GM_addStyle
// @grant		GM.setValue
// @grant		GM.getValue
// ==/UserScript==

// Paylocity selectors (If the script isn't working, there's a good chance Paylocity has updated its layout slightly)
const loadedSelector = '[data-section="TIMEOFF"] .card-content table a'
const requestTimeOffBtnSelector = '[data-automation-id="Portal-TO-WPRequestTimeOffButton"]'
const tableSelector = '#time-off-table'
const columnMap = {
	type: {
		index: 0,
		customName: 'Type',
	},
	available: {
		index: 1,
		customName: 'Available to Request',
	},
	unused: {
		index: 2,
		customName: 'Unused (Includes Planned)',
		hidden: true,
	},
	used: {
		index: 3,
		customName: 'Used',
	},
	planned: {
		index: 4,
		customName: 'Planned',
	},
}

// User's config options
const { totalDays, halfDay } = await GM.getValues({ totalDays: 25, halfDay: 4 })

// Internal IDs for injected HTML
const id = {
	backdrop: uniqueId(),
	modal: uniqueId(),
	modalCloseBtn: uniqueId(),
	modalConfigBtn: uniqueId(),
	primaryBtn: uniqueId(),
	settingsCancelBtn: uniqueId(),
	settingsHalfInput: uniqueId(),
	settingsModal: uniqueId(),
	settingsSaveBtn: uniqueId(),
	settingsTotalInput: uniqueId(),
	table: uniqueId(),
	tableExpiryDate: uniqueId(),
	targetLinks: uniqueId(),
	targetTable: uniqueId(),
}

// All PTO types
const PTOtypes = [
	// TODO: Add any missing expiry dates
	{ name: 'BRVMT - Bereavement' },
	{ name: 'CSFPH - SanFran PHE Leave' },
	{ name: 'FLY - Flyer Holiday', expires: 'December 31st' },
	{ name: 'FMLA - FMLA', expires: '?' },
	{ name: 'JUR - Jury Duty' },
	{ name: 'JURY - Jury Duty' },
	{ name: 'MAPF - MA Paid Family Medical Leave' },
	{ name: 'MAUK - Maternity Leave UK' },
	{ name: 'MBA - MBA Time Off', expires: '?' },
	{ name: 'MED - Medical' },
	{ name: 'MEDMA - Medical Maternity' },
	{ name: 'OSHVX - OSHA Vaccine Mandated PTO' },
	{ name: 'PB - Parental Bonding' },
	{ name: 'PERS - Personal Days', expires: 'December 31st' },
	{ name: 'PTOCA - Paid Time Off CA', expires: 'December 31st', primaryBucket: true },
	{ name: 'PTOCD - PTO Canada', expires: '?', primaryBucket: true },
	{ name: 'PTODE - PTO DE', expires: '?', primaryBucket: true },
	{ name: 'PTOR - Rollover PTO', expires: 'March 31st' },
	{ name: 'PTOU - Unpaid Time Off', expires: '?' },
	{ name: 'PTOUK - Paid Time Off UK', expires: 'December 31st', primaryBucket: true },
	{ name: 'PTOUS - Paid Time Off US', expires: 'December 31st', primaryBucket: true },
	{ name: 'SB - Sabbatical' },
	{ name: 'SICK - SICK TIME OFF' },
	{ name: 'STD - Short Term Disability' },
	{ name: 'UPERS - Unpaid Personal Leave' },
]

// Wait for the async section to exist before we start modifying the page
waitForElement(loadedSelector).then(async () => {
	GM_addStyle(styles)
	injectElements()

	// If this is the first time running the script, automatically prompt the users to complete the config
	const settings = await GM.getValues(['totalDays'])
	if (!settings.totalDays) {
		onToggleSettings()
	}
})

function injectElements() {

	// The button for opening the modal
	const button = htmlToNode(buttonHtml)
	document.querySelector(requestTimeOffBtnSelector)?.after(button)

	// The modal views
	const modal = htmlToNode(modalHtml)
	document.querySelector('body').append(modal)

	// Build a table based on the page's existing data
	const newTable = buildTable()
	document.getElementById(id.targetTable).append(newTable)

	// Useful links under the table
	const originalHistoryLink = querySelectorAllWithText(document, 'a', 'Time Off Request History')
	const historyLink = originalHistoryLink.cloneNode(true)
	// Simplify the link and strip out chiled buttons
	for (let i = 0; i < historyLink.childNodes.length; i++) {
		if (historyLink.childNodes[i].nodeType !== 3) historyLink.removeChild(historyLink.childNodes[i--])
	}
	document.getElementById(id.targetLinks).append(historyLink)

	// One listener to rule them all
	document.addEventListener('click', e => {
		switch (e.target.id) {
			case id.primaryBtn: {
				onToggleModal()
				break
			}
			case id.backdrop: {
				onToggleModal()
				break
			}
			case id.settingsSaveBtn: {
				onSettingsChange()
				break
			}
			case id.settingsCancelBtn: {
				onToggleSettings()
				break
			}
			case id.modalCloseBtn: {
				onToggleModal()
				break
			}
			case id.modalConfigBtn: {
				onToggleSettings()
				break
			}
		}
	})
}

function buildTable() {
	// Copy the built in table
	const originalTable = document.querySelector(tableSelector)
	const newTable = originalTable.cloneNode(true)
	newTable.id = id.table
	removeInlineStyles(newTable)

	// Clean up extra hidden cells paylocity adds to their table
	const tidyUp = [...newTable.querySelectorAll('.wpss_checkboxtd')]
	tidyUp.forEach(tidy => tidy.remove())

	// Better column titles
	const headers = [...newTable.querySelectorAll('th')]
	Object.values(columnMap).forEach(col => {
		const header = headers[col.index]
		if (header) {
			header.textContent = col.customName

			if (col.hidden) {
				header.classList.add('hiddenColumn')
			}
		}
	})

	let totalDaysAvailable = 0

	// Update table contents
	PTOtypes.forEach(pto => {
		const link = querySelectorAllWithText(newTable, 'a', pto.name.toLocaleUpperCase())
		if (!link) return

		if (pto.expires) {
			const expiresText = document.createElement('span')
			expiresText.textContent = `(Expires: ${pto.expires})`
			expiresText.classList.add(id.tableExpiryDate)
			link.after(expiresText)
		}
		const row = link.closest('tr')

		// Grab the data
		const cells = [...row.querySelectorAll('td')]
		const cellMap = {
			available: {
				elm: cells[columnMap.available.index],
				days: hoursStringToDays(cells[columnMap.available.index].textContent),
				originalHoursText: cells[columnMap.available.index].textContent,
				hidden: columnMap.available.hidden,
			},
			unused: {
				elm: cells[columnMap.unused.index],
				days: hoursStringToDays(cells[columnMap.unused.index].textContent),
				originalHoursText: cells[columnMap.unused.index].textContent,
				hidden: columnMap.unused.hidden,
			},
			used: {
				elm: cells[columnMap.used.index],
				days: hoursStringToDays(cells[columnMap.used.index].textContent),
				originalHoursText: cells[columnMap.used.index].textContent,
				hidden: columnMap.used.hidden,
			},
			planned: {
				elm: cells[columnMap.planned.index],
				days: hoursStringToDays(cells[columnMap.planned.index].textContent),
				originalHoursText: cells[columnMap.planned.index].textContent,
				hidden: columnMap.planned.hidden,
			},
		}

		// Show the correct available days, monthly accrual shouldn't be user-facing...
		if (pto.primaryBucket) {
			cellMap.available.days = totalDays - cellMap.used.days - cellMap.planned.days
			cellMap.unused.days = totalDays - cellMap.used.days
		}

		// Add up all days available (except sick days)
		if (cells[columnMap.type.index].querySelector('a')?.textContent.toLowerCase().indexOf('sick') === -1) {
			totalDaysAvailable += cellMap.available.days
		}

		// Update the values to days instead of hours
		for (const value of Object.values(cellMap)) {
			value.elm.textContent = `${value.days} Day${value.days === 1 ? '' : 's'}`
			if (value.hidden) {
				value.elm.classList.add('hiddenColumn')
			}
		}
	})

	// Show total time available in the card header
	originalTable.closest('.card').querySelector('h2').innerHTML = `Time Off: <span style="color:#fc2621;">${totalDaysAvailable} days</span> available`

	return newTable
}

// User actions
function onToggleModal() {
	const backdrop = document.getElementById(id.backdrop)
	backdrop.classList.toggle('show')
	backdrop.classList.remove('showSettings')
}

function onToggleSettings() {
	const backdrop = document.getElementById(id.backdrop)
	backdrop.classList.add('show')
	backdrop.classList.toggle('showSettings')
}

async function onSettingsChange() {
	const newTotalDays = parseInt(document.getElementById(id.settingsTotalInput)?.value)
	const newHoursPerHalfDay = parseInt(document.getElementById(id.settingsHalfInput)?.value)
	if (newTotalDays && newHoursPerHalfDay) {
		await GM.setValues({ totalDays: newTotalDays, halfDay: newHoursPerHalfDay })
		// This is a bit nasty, but as this is intended as a set and forget, so I'm not going to put effort into updating the table automatically
		location.reload()
	}
}

// Utilities
function waitForElement(selector) {
	return new Promise(resolve => {
		if (document.querySelector(selector)) {
			return resolve(document.querySelector(selector))
		}
		const observer = new MutationObserver(mutations => {
			if (document.querySelector(selector)) {
				resolve(document.querySelector(selector))
				observer.disconnect()
			}
		})
		observer.observe(document.body, { childList: true, subtree: true })
	})
}

function hoursStringToDays(hours) {
	const hoursNum = parseFloat(hours)
	return (halfDay * Math.round(hoursNum / halfDay)) / (halfDay * 2)
}

function htmlToNode(html) {
	const template = document.createElement('template')
	template.innerHTML = html
	return template.content.firstElementChild
}

function querySelectorAllWithText(parent, selector, text) {
	return [...parent.querySelectorAll(selector)].find(el => el.textContent.includes(text))
}

function removeInlineStyles(elm) {
	elm.removeAttribute('style')
	for (let child in elm.childNodes) {
		if (elm.childNodes[child].nodeType === 1) {
			removeInlineStyles(elm.childNodes[child])
		}
	}
}

function uniqueId() {
	return `PaylocityFixer-${self.crypto.randomUUID()}`
}

// Injected styles
const styles = `
	#${id.backdrop} {
		display: none;
		left: 0;
		position: fixed;
		right: 0;
		top: 0;
		bottom: 0;
		z-index: 999999999999;
		backdrop-filter: blur(4px) brightness(60%);
	}
	#${id.backdrop}.show {
		display: block;
	}
	#${id.backdrop}.showSettings #${id.modal} {
		display: none;
	}
	#${id.backdrop}.showSettings #${id.settingsModal} {
		display: block;
	}
	#${id.settingsModal} {
		background: #fff;
		border-radius: 20px;
		border: 1px solid #bbb;
		box-shadow: 0px 4px 12px rgba(166, 176, 186, 0.4);
		display: none;
		left: 50%;
		left: 50%;
		padding: 20px;
		position: fixed;
		top: 80px;
		transform: translateX(-50%);
		z-index: 999999999999;

		h3 {
			margin-bottom: 20px;
		}
		label {
			display: block;
			margin-bottom: 10px;
		}
		input {
			display: block;
			margin-top: 6px;
			width: 100%;
		}
		button {
			margin: 0 auto;
		}
	}
	#${id.modal} {
		background: #fff;
		border-radius: 20px;
		border: 1px solid #bbb;
		box-shadow: 0px 4px 12px rgba(166, 176, 186, 0.4);
		left: 40px;
		padding: 60px 20px 20px 20px;
		position: fixed;
		right: 40px;
		top: 80px;
		z-index: 999999999999;
	}
	#${id.modalCloseBtn} {
		background: #eee;
		border-radius: 30px;
		border: 1px solid #bbb;
		font-size: 20px;
		height: 40px;
		position: absolute;
		right: 20px;
		top: 20px;
		width: 40px;
		z-index: 999999999999;
	}
	#${id.modalConfigBtn} {
		background: #eee;
		border-radius: 30px;
		border: 1px solid #bbb;
		font-size: 22px;
		height: 40px;
		position: absolute;
		right: 66px;
		top: 20px;
		width: 40px;
		z-index: 999999999999;
	}
	#${id.table} {
		margin-bottom: 30px;
		th {
			padding-bottom: 6px;
			font-size: 14px;
			text-align: left;
		}
		.${id.tableExpiryDate} {
			font-size: 10px;
			margin-left: 10px;
		}
		.hiddenColumn {
			display: none;
		}
	}
`

// Injected HTML
const modalHtml = `
	<div id="${id.backdrop}">
		<div id="${id.modal}">
			<button type="button" id="${id.modalCloseBtn}">✖</button>
			<button type="button" id="${id.modalConfigBtn}">⚙</button>
			<div id="${id.targetTable}"></div>
			<div id="${id.targetLinks}"></div>
		</div>

		<div id="${id.settingsModal}">
			<h3>Paylocity helper config</h3>
			<label>
				Total days:
				<input type="text" id="${id.settingsTotalInput}" value="${totalDays || 25}" />
			</label>
			<label>
				Hours per half-day:
				<input type="text" id="${id.settingsHalfInput}" value="${halfDay || 4}" />
			</label>
			<button
				type="button"
				id="${id.settingsSaveBtn}"
				class="button small citrus-button"
			>Save</button>
			<button
				type="button"
				id="${id.settingsCancelBtn}"
				class="button small citrus-button"
			>Cancel</button>
		</div>
	</div>
`

const buttonHtml = `
	<button
		type="button"
		class="button small citrus-button"
		id="${id.primaryBtn}"
	>
		Easy View
	</button>
`
