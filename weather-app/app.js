if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js");
}

const WEATHER_API_URL = "https://api.openweathermap.org/data/2.5/weather";
const FRANKFURTER_URL = "https://api.frankfurter.app/latest";
const COINGECKO_URL = "https://api.coingecko.com/api/v3/simple/price";

let apiKey = localStorage.getItem("api_key") || "";
let defaultCity = localStorage.getItem("default_city") || "Przemyśl";

const tabs = document.querySelectorAll(".tab");
const sections = document.querySelectorAll(".tab-content");

tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    const target = tab.dataset.tab; 
    tabs.forEach((t) => t.classList.remove("active"));
    sections.forEach((s) => s.classList.remove("active"));

    tab.classList.add("active");
    document.getElementById(target).classList.add("active");
  });
});
async function fetchWeather(city) {
  if (!apiKey) {
    alert("Спочатку введи API ключ в налаштуваннях");
    return;
  }

  const url = `${WEATHER_API_URL}?q=${city}&appid=${apiKey}&units=metric&lang=ua`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Помилка: ${response.status}`);
    }
    const data = await response.json();
    renderWeather(data); 
  } catch (error) {
    console.error("Не вдалось отримати погоду:", error);
  }
}
function renderWeather(data) {
 const cityName = document.getElementById("city-name");
 const weatherDate = document.getElementById("weather-date");
 const weatherMain = document.querySelector(".weather-main");
 const weatherDetails = document.querySelector(".weather-details");

 cityName.textContent = data.name;
 const date = new Date();
 weatherDate.textContent = date.toLocaleDateString("uk-UA", {
   day: "numeric",
   month: "long",
   year: "numeric",
 });
 const temp = Math.round(data.main.temp);
 const iconCode = data.weather[0].icon;
 const description = data.weather[0].description;
 const humidity = data.main.humidity;
 const windSpeed = data.wind.speed;

 weatherMain.innerHTML = `
   <img src="https://openweathermap.org/img/wn/${iconCode}.png" alt="${description}" />
   <p>${temp}°C</p>`;

 weatherDetails.innerHTML = `
   <p style="text-transform: capitalize;">${description}</p>
   <p>Вологість: ${humidity}%</p>
   <p>Вітер: ${windSpeed} м/с</p>`;
}
async function fetchFiatRates() {
  const response = await fetch("https://api.frankfurter.dev/v1/latest?from=USD&to=PLN,EUR");
  const data = await response.json();
  return data.rates;
}
async function fetchNBURate(currency) {
  const url = `https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?valcode=${currency}&json`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Не вдалося отримати курс NBU: ${response.status}`);
  }

  const data = await response.json();
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error(`Немає курсу для валюти ${currency}`);
  }

  return data[0].rate;
}
async function loadCurrencies() {
  const currencyList = document.querySelector(".currency-list");
  currencyList.innerHTML = ""; 
  try {
    const [fiatRates, nbuRate] = await Promise.all([fetchFiatRates(), fetchNBURate("USD")]);

    for (const [currency, rate] of Object.entries(fiatRates)) {
      renderCurrencyCard(`USD / ${currency}`, rate);
    }

    renderCurrencyCard("USD / UAH", nbuRate);
  } catch (error) {
    console.error("Не вдалося завантажити курси валют:", error);
    currencyList.innerHTML = `<p style="color: #fbbf24;">Не вдалося отримати курси валют. Спробуйте пізніше.</p>`;
  }
}
function renderCurrencyCard(pair, rate) {
  const currencyList = document.querySelector(".currency-list");
  const card = document.createElement("div");
  card.className = "currency-card";
  card.innerHTML = `
    <span class="currency-pair">${pair}</span>
    <span class="currency-rate">${rate.toFixed(2)}</span>
  `;
  currencyList.appendChild(card);
}
document.getElementById("api-key-input").value = apiKey;
document.getElementById("city-input").value = defaultCity;


document.getElementById("save-api-key").addEventListener("click", () => {
  const value = document.getElementById("api-key-input").value.trim();

  if (!value) {
    alert("Введи API ключ перед збереженням.");
    return;
  }

  apiKey = value;
  localStorage.setItem("api_key", apiKey);
  alert("API ключ збережено.");
});


document.getElementById("save-city").addEventListener("click", () => {
  const value = document.getElementById("city-input").value.trim();

  if (!value) {
    alert("Введи місто перед збереженням.");
    return;
  }

  defaultCity = value;
  localStorage.setItem("default_city", defaultCity);
  alert("Місто збережено.");
});




document.getElementById("refresh-currency").addEventListener("click", loadCurrencies);




function init() {
  if (apiKey) {
    fetchWeather(defaultCity);
  } else {
    const cityName = document.getElementById("city-name");
    const weatherMain = document.querySelector(".weather-main");
    const weatherDetails = document.querySelector(".weather-details");

    cityName.textContent = "Потрібен API ключ";
    weatherMain.innerHTML = `<p>Введи OpenWeatherMap API ключ у вкладці "Налаштування".</p>`;
    weatherDetails.innerHTML = "";
  }

  loadCurrencies();
}

init();
