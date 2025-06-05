import { locationCleanup } from './utils/string.mjs';
import { elemForEach } from './utils/elem.mjs';
import getCurrentWeather from './currentweather.mjs';
import { currentDisplay } from './navigation.mjs';

// constants
const degree = String.fromCharCode(176);
const SCROLL_SPEED = 75; // pixels/second
const DEFAULT_UPDATE = 8; // 0.5s ticks

// local variables
let interval;
let screenIndex = 0;
let sinceLastUpdate = 0;
let nextUpdate = DEFAULT_UPDATE;

// start drawing conditions
// reset starts from the first item in the text scroll list
const start = () => {
	// store see if the context is new

	// set up the interval if needed
	if (!interval) {
		interval = setInterval(incrementInterval, 500);
	}

	// draw the data
	drawScreen();
};

const stop = (reset) => {
	if (reset) screenIndex = 0;
};

// increment interval, roll over
// forcing is used when drawScreen receives an invalid screen and needs to request the next one in line
const incrementInterval = (force) => {
	if (!force) {
		// test for elapsed time (0.5s ticks);
		sinceLastUpdate += 1;
		if (sinceLastUpdate < nextUpdate) return;
	}
	// reset flags
	sinceLastUpdate = 0;
	nextUpdate = DEFAULT_UPDATE;

	// test current screen
	const display = currentDisplay();
	if (!display?.okToDrawCurrentConditions) {
		stop(display?.elemId === 'progress');
		return;
	}
	screenIndex = (screenIndex + 1) % (lastScreen);
	// draw new text
	drawScreen();
};

const drawScreen = async () => {
	// get the conditions
	const data = await getCurrentWeather();

	// nothing to do if there's no data yet
	if (!data) return;

	const thisScreen = screens[screenIndex](data);
	if (typeof thisScreen === 'string') {
		// only a string
		drawCondition(thisScreen);
	} else if (typeof thisScreen === 'object') {
		// an object was provided with additional parameters
		switch (thisScreen.type) {
			case 'scroll':
				drawScrollCondition(thisScreen);
				break;
			case 'sports':
				drawSportsCondition(thisScreen);
				break;
			default: drawCondition(thisScreen);
		}
	} else {
		// can't identify screen, get another one
		incrementInterval(true);
	}
};

// the "screens" are stored in an array for easy addition and removal
const screens = [
	// station name
	(data) => `Conditions at ${locationCleanup(data.station.properties.name).substr(0, 20)}`,

	// temperature
	(data) => {
		let text = `Temp: ${data.Temperature}${degree}${data.TemperatureUnit}`;
		if (data.observations.heatIndex.value) {
			text += `    Heat Index: ${data.HeatIndex}${degree}${data.TemperatureUnit}`;
		} else if (data.observations.windChill.value) {
			text += `    Wind Chill: ${data.WindChill}${degree}${data.TemperatureUnit}`;
		}
		return text;
	},

	// humidity
	(data) => `Humidity: ${data.Humidity}%   Dewpoint: ${data.DewPoint}${degree}${data.TemperatureUnit}`,

	// barometric pressure
	//(data) => `Barometric Pressure: ${data.Pressure} ${data.PressureDirection}`,

	// wind
	(data) => {
		let text = data.WindSpeed > 0
			? `Wind: ${data.WindDirection} ${data.WindSpeed} ${data.WindUnit}`
			: 'Wind: Calm';

		if (data.WindGust > 0) {
			text += `  Gusts to ${data.WindGust}`;
		}
		return text;
	},

	// visibility
	(data) => {
		const distance = `${data.Ceiling} ${data.CeilingUnit}`;
		return `Visib: ${data.Visibility} ${data.VisibilityUnit}  Ceiling: ${data.Ceiling === 0 ? 'Unlimited' : distance}`;
	},
];

// internal draw function with preset parameters
const drawCondition = (text) => {
	// update all html scroll elements
	elemForEach('.weather-display .scroll .fixed', (elem) => {
		elem.innerHTML = text;
	});
};
document.addEventListener('DOMContentLoaded', () => {
	start();
});

// store the original number of screens
const originalScreens = screens.length;
let lastScreen = originalScreens;

// reset the number of screens
const reset = () => {
	lastScreen = originalScreens;
};

// add screen
const addScreen = (screen) => {
	screens.push(screen);
	lastScreen += 1;
};

const drawScrollCondition = (screen) => {
	// create the scroll element
	const scrollElement = document.createElement('div');
	scrollElement.classList.add('scroll-area');
	scrollElement.innerHTML = screen.text;
	// add it to the page to get the width
	document.querySelector('.weather-display .scroll .fixed').innerHTML = scrollElement.outerHTML;
	// grab the width
	const { scrollWidth, clientWidth } = document.querySelector('.weather-display .scroll .fixed .scroll-area');

	// calculate the scroll distance and set a minimum scroll
	const scrollDistance = Math.max(scrollWidth - clientWidth, 0);
	// calculate the scroll time
	const scrollTime = scrollDistance / SCROLL_SPEED;
	// calculate a new minimum on-screen time +1.0s at start and end
	nextUpdate = Math.round(Math.ceil(scrollTime / 0.5) + 4);

	// update the element transition and set initial left position
	scrollElement.style.left = '0px';
	scrollElement.style.transition = `left linear ${scrollTime.toFixed(1)}s`;
	elemForEach('.weather-display .scroll .fixed', (elem) => {
		elem.innerHTML = '';
		elem.append(scrollElement.cloneNode(true));
	});
	// start the scroll after a short delay
	setTimeout(() => {
		// change the left position to trigger the scroll
		elemForEach('.weather-display .scroll .fixed .scroll-area', (elem) => {
			elem.style.left = `-${scrollDistance.toFixed(0)}px`;
		});
	}, 1000);
};

window.CurrentWeatherScroll = {
	addScreen,
	reset,
};

// Sports data storage
let sportsData = [];
let sportsDataLastFetch = null;
const SPORTS_CACHE_DURATION = 10 * 60 * 1000; // 10 minutes

// Function to fetch sports data
const fetchSportsData = async () => {
	try {
		const now = Date.now();
		// Check if we have cached data that's still fresh
		if (sportsData.length > 0 && sportsDataLastFetch && (now - sportsDataLastFetch) < SPORTS_CACHE_DURATION) {
			return sportsData;
		}

		const response = await fetch('https://site.api.espn.com/apis/personalized/v2/scoreboard/header?_ceID=espn-en-frontpage-index&configuration=SITE_DEFAULT&playabilitySource=playbackId&lang=en&region=us&contentorigin=espn&tz=America%2FNew_York&platform=web&showAirings=buy%2Clive%2Creplay&showZipLookup=true&buyWindow=1m&postalCode=30033', {
			method: 'GET',
			headers: {
				'Accept': 'application/json',
			}
		});

		if (!response.ok) {
			throw new Error(`Sports API responded with status: ${response.status}`);
		}

		const data = await response.json();

		// Parse the ESPN data structure
		const games = [];

		// ESPN API structure may vary, but typically has leagues and games
		if (data.sports) {
			data.sports.forEach(sport => {
				if (sport.leagues) {
					console.log(`Processing sport: ${sport.name}`);
					sport.leagues.forEach(league => {
						if (league.events) {
							league.events.forEach(event => {
								const game = parseSportsEvent(event, league.shortName || league.name);
								if (game) {
									games.push(game);
								}
							});
						}
					});
				}
			});
		}

		sportsData = games;
		sportsDataLastFetch = now;
		return games;
	} catch (error) {
		console.error('Failed to fetch sports data:', error);
		// Return cached data if available, otherwise empty array
		return sportsData.length > 0 ? sportsData : [];
	}
};

// Function to parse individual sports events
const parseSportsEvent = (event, leagueName) => {
	try {
		// Ignore leagues that are not MLB, NBA, NFL, NHL, or PGA
		if (!leagueName || !['MLB', 'NBA', 'NFL', 'NHL', 'PGA'].includes(leagueName)) {
			console.log('Ignoring unsupported league:', leagueName);
			return null;
		}


		if (!event.competitors) {
			console.log('no competitions or competitors found in event:', event);
			return null;
		}

		const competitors = event.competitors;

		if (competitors.length < 2) {
			return null;
		}

		// Get team information
		const team1 = competitors[0];
		const team2 = competitors[1];

		const team1Logo = team1.logo || null;
		const team2Logo = team2.logo || null;

		const team1Name = team1.abbreviation || team1.shortDisplayName || team1.displayName || 'TBD';
		const team2Name = team2.abbreviation || team2.shortDisplayName || team2.displayName || 'TBD';

		const team1Score = team1.score || '0';
		const team2Score = team2.score || '0';

		// Determine game status
		let status = 'Scheduled';
		let displayTime = '';

		if (event.fullStatus) {
			const statusType = event.fullStatus.type?.name || '';
			const statusDetail = event.fullStatus.type?.detail || '';

			if (statusType === 'STATUS_FINAL') {
				status = 'Final';
			} else if (statusType === 'STATUS_IN_PROGRESS') {
				status = 'Live';
				displayTime = event.fullStatus.type?.shortDetail || 'Live';
			} else if (statusType === 'STATUS_SCHEDULED') {
				status = 'Scheduled';
				// Parse the start time
				if (event.date) {
					const gameTime = new Date(event.date);
					displayTime = gameTime.toLocaleTimeString('en-US', {
						hour: 'numeric',
						minute: '2-digit',
						hour12: true
					});
				}
			}
		}

		return {
			league: leagueName,
			team1: team1Name,
			team2: team2Name,
			score1: team1Score,
			score2: team2Score,
			team1Logo: team1Logo,
			team2Logo: team2Logo,
			status: status,
			displayTime: displayTime,
			isLive: status === 'Live'
		};
	} catch (error) {
		console.error('Error parsing sports event:', error);
		return null;
	}
};

// Function to create sports screens
const createSportsScreens = (games) => {
	const sportsScreens = [];

	games.forEach(game => {
		// Create a function that returns the sports data, just like weather screens
		const sportsScreenFunction = () => {
			let scoreText = '';

			if (game.status === 'Final') {
				scoreText = `${game.league}: ${game.team1} ${game.score1}, ${game.team2} ${game.score2} - Final`;
			} else if (game.status === 'Live') {
				scoreText = `${game.league}: ${game.team1} ${game.score1}, ${game.team2} ${game.score2} - ${game.displayTime}`;
			} else if (game.status === 'Scheduled') {
				scoreText = `${game.league}: ${game.team1} vs ${game.team2}`;
				if (game.displayTime) {
					scoreText += ` - ${game.displayTime}`;
				}
			}

			// If we have logos, return a special sports object
			if (game.team1Logo || game.team2Logo) {
				return {
					type: 'sports',
					league: game.league,
					team1: game.team1,
					team2: game.team2,
					score1: game.score1,
					score2: game.score2,
					team1Logo: game.team1Logo,
					team2Logo: game.team2Logo,
					status: game.status,
					displayTime: game.displayTime,
					text: scoreText,
					isLive: game.isLive
				};
			}

			// For live games or long text without logos, make it scroll
			if ((game.isLive && scoreText.length > 45) || scoreText.length > 60) {
				return {
					type: 'scroll',
					text: scoreText
				};
			} else {
				return scoreText;
			}
		};

		sportsScreens.push(sportsScreenFunction);
	});

	return sportsScreens;
};

// Function to create sports display with logos
const drawSportsCondition = (sportsData) => {
	// Create a container for the sports display
	const sportsContainer = document.createElement('div');
	sportsContainer.classList.add('sports-display');
	sportsContainer.style.cssText = `
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		padding: 2px 2px;
		font-family: monospace;
		font-size: 28px;
		white-space: nowrap;
	`;

	// League name
	const leagueSpan = document.createElement('span');
	leagueSpan.textContent = sportsData.league + ':';
	leagueSpan.style.cssText = `
		font-weight: bold;
		margin-right: 5px;
	`;
	sportsContainer.appendChild(leagueSpan);

	// Team 1 logo
	if (sportsData.team1Logo) {
		const team1LogoImg = document.createElement('img');
		team1LogoImg.src = sportsData.team1Logo;
		team1LogoImg.alt = sportsData.team1;
		team1LogoImg.style.cssText = `
			width: 22px;
			height: 22px;
			object-fit: contain;
			margin-right: 2px;
		`;
		team1LogoImg.onerror = function () {
			this.style.display = 'none';
		};
		sportsContainer.appendChild(team1LogoImg);
	}

	// Team 1 name and score
	const team1Span = document.createElement('span');
	let team1Text = sportsData.team1;
	if (sportsData.status === 'Final' || sportsData.status === 'Live') {
		team1Text += ` ${sportsData.score1}`;
	}
	team1Span.textContent = team1Text;
	sportsContainer.appendChild(team1Span);

	// VS or comma separator
	const separatorSpan = document.createElement('span');
	separatorSpan.textContent = sportsData.status === 'Scheduled' ? ' vs ' : ', ';
	separatorSpan.style.margin = '0 2px';
	sportsContainer.appendChild(separatorSpan);

	// Team 2 logo
	if (sportsData.team2Logo) {
		const team2LogoImg = document.createElement('img');
		team2LogoImg.src = sportsData.team2Logo;
		team2LogoImg.alt = sportsData.team2;
		team2LogoImg.style.cssText = `
			width: 22px;
			height: 22px;
			object-fit: contain;
			margin-right: 2px;
		`;
		team2LogoImg.onerror = function () {
			this.style.display = 'none';
		};
		sportsContainer.appendChild(team2LogoImg);
	}

	// Team 2 name and score
	const team2Span = document.createElement('span');
	let team2Text = sportsData.team2;
	if (sportsData.status === 'Final' || sportsData.status === 'Live') {
		team2Text += ` ${sportsData.score2}`;
	}
	team2Span.textContent = team2Text;
	sportsContainer.appendChild(team2Span);

	// Status/time
	if (sportsData.displayTime || sportsData.status === 'Final') {
		const statusSpan = document.createElement('span');
		statusSpan.textContent = sportsData.status === 'Final' ? ' - Final' :
			(sportsData.displayTime ? ` - ${sportsData.displayTime}` : '');
		statusSpan.style.cssText = `
			margin-left: 5px;
			font-style: italic;
		`;
		if (sportsData.isLive) {
			statusSpan.style.color = '#ff6b6b';
			statusSpan.style.fontWeight = 'bold';
		}
		sportsContainer.appendChild(statusSpan);
	}

	// Update all scroll elements with the sports container
	elemForEach('.weather-display .scroll .fixed', (elem) => {
		elem.innerHTML = '';
		elem.appendChild(sportsContainer.cloneNode(true));
	});
};

// Function to add sports data to the rotation
const addSportsToRotation = async () => {
	try {
		const games = await fetchSportsData();

		if (games.length === 0) {
			console.log('No sports data available');
			return;
		}

		// Create sports screens
		const sportsScreens = createSportsScreens(games);

		// Add sports screens to the rotation
		sportsScreens.forEach(screen => {
			addScreen(screen);
		});

		console.log(`Added ${sportsScreens.length} sports screens to rotation`);
	} catch (error) {
		console.error('Failed to add sports to rotation:', error);
	}
};

// Function to periodically update sports data
const startSportsUpdates = () => {
	// Initial load
	addSportsToRotation();

	// Update every 5 minutes
	setInterval(() => {
		// Reset screens to original count
		reset();
		// Re-add sports data
		addSportsToRotation();
	}, 5 * 60 * 1000);
};

window.CurrentWeatherScroll = {
	...window.CurrentWeatherScroll,
	addSportsToRotation,
	startSportsUpdates,
	fetchSportsData // Export for debugging
};

// Auto-start sports updates when the module loads
// You can comment this out if you want to manually control when sports start
document.addEventListener('DOMContentLoaded', () => {
	// Add a small delay to ensure other systems are initialized
	setTimeout(startSportsUpdates, 2000);
});