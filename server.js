require("dotenv").config();
const express = require("express");
const cors = require("cors");
const axios = require("axios");

const app = express();
const PORT = process.env.PORT || 3000;

// CWA API 設定
const CWA_API_BASE_URL = "https://opendata.cwa.gov.tw/api";
const CWA_API_KEY = process.env.CWA_API_KEY;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({
  extended: true
}));

/**
 * 取得指定縣市天氣預報
 * CWA 氣象資料開放平臺 API
 * 使用「一般天氣預報-今明 36 小時天氣預報」資料集
 * 支援路由參數 `:location` 或 query param `location`，可使用短鍵（例如 `kinmen`）或中文縣市名稱（例如 `金門縣`）。
 */

const getLocationName = (req) => {
  // 解析使用者傳入的縣市代碼或名稱（優先順序：route param > query param > 預設 taipei)
  const locationParam = req.params.location || req.query.location || "taipei";
  const locationKey = String(locationParam).trim();

  // 簡單代碼到中文名稱的映射，可視需要擴充
  const locationMap = {
    taipei: "臺北市",
    newtaipei: "新北市",
    keelung: "基隆市",
    taoyuan: "桃園市",
    hsinchu: "新竹縣",
    hsinchuCity: "新竹市",
    miaoli: "苗栗縣",
    taichung: "臺中市",
    nantou: "南投縣",
    changhua: "彰化縣",
    yunlin: "雲林縣",
    chiayi: "嘉義縣",
    chiayiCity: "嘉義市",
    tainan: "臺南市",
    kaohsiung: "高雄市",
    pingtung: "屏東縣",
    yilan: "宜蘭縣",
    hualien: "花蓮縣",
    taitung: "臺東縣",
    kinmen: "金門縣",
    penghu: "澎湖縣",
    matsu: "連江縣",

  };

  // 若找不到對應的映射，回傳原始輸入（確保會回傳字串）
  return locationMap[locationKey] || locationParam;
}


// 已移除單獨的 36 小時與 7 天 handler，使用 `getCombinedWeather` 作為單一入口。

// 已移除單獨的 36 小時與 7 天 handler，使用 `getCombinedWeather` 作為單一入口。

// Helper: 將 CWA response 解析為統一格式的 weatherData
const parseWeatherResponse = (response) => {
  // console.log("parseWeatherResponse response", response)
  if (!response || !response.data || !response.data.records || !Array.isArray(response.data.records.location) || !response.data.records.location[0]) {
    return null;
  }

  const locationData = response.data.records.location[0];

  const weatherData = {
    city: locationData.locationName,
    updateTime: response.data.records.datasetDescription,
    forecasts: [],
  };

  const weatherElements = locationData.weatherElement;
  if (!Array.isArray(weatherElements) || !weatherElements[0] || !Array.isArray(weatherElements[0].time)) {
    return null;
  }

  const timeCount = weatherElements[0].time.length;

  for (let i = 0; i < timeCount; i++) {
    const forecast = {
      startTime: weatherElements[0].time[i].startTime,
      endTime: weatherElements[0].time[i].endTime,
      weather: "",
      rain: "",
      minTemp: "",
      maxTemp: "",
      comfort: "",
      windSpeed: "",
    };

    weatherElements.forEach((element) => {
      const value = element.time[i].parameter;
      switch (element.elementName) {
        case "Wx":
          forecast.weather = value.parameterName;
          break;
        case "PoP":
          forecast.rain = value.parameterName + "%";
          break;
        case "MinT":
          forecast.minTemp = value.parameterName + "°C";
          break;
        case "MaxT":
          forecast.maxTemp = value.parameterName + "°C";
          break;
        case "CI":
          forecast.comfort = value.parameterName;
          break;
        case "WS":
          forecast.windSpeed = value.parameterName;
          break;
      }
    });

    weatherData.forecasts.push(forecast);
  }

  return weatherData;
};

const getHoursWeather = (locationName) => {
  const hoursUrl = `${CWA_API_BASE_URL}/v1/rest/datastore/F-C0032-001`;

  return axios.get(hoursUrl, {
    params: {
      Authorization: CWA_API_KEY,
      locationName
    }
  })
};

const getWeekWeather = (locationName) => {
  console.log('locationName', locationName);
  const weekUrl = `${CWA_API_BASE_URL}/v1/rest/datastore/F-D0047-089`;

  return axios.get(weekUrl, {
    params: {
      Authorization: CWA_API_KEY,
      locationName,
      ElementName: "溫度"
    }
  })
};

// 合併回傳 36 小時與 7 天的天氣資料
const getCombinedWeather = async (req, res) => {
  try {
    if (!CWA_API_KEY) {
      return res.status(500).json({
        error: "伺服器設定錯誤",
        message: "請在 .env 檔案中設定 CWA_API_KEY",
      });
    }

    // 解析 locationName，若 mapping 無結果則回傳原始輸入
    const locationName = getLocationName(req);
    const response = await Promise.all([getHoursWeather(locationName), getWeekWeather(locationName)])
    console.log('response',response[1].data.records.Locations[0].Location);

    // const [hoursResp, weekResp] = await Promise.all([getHoursWeather(locationName), getWeekWeather(locationName)]);
    // console.log("hoursResp", hoursResp);
    // console.log("weekResp", weekResp);


    const hoursData = parseWeatherResponse(response[0]);
    const weekData = parseWeatherResponse(response[1]);

    if (!hoursData && !weekData) {
      return res.status(404).json({
        error: "查無資料",
        message: "無法取得該縣市天氣資料",
      });
    }

    const combined = {
      success: true,
      data: {
        city: (hoursData && hoursData.city) || (weekData && weekData.city) || locationName,
        updateTime: {
          hours: hoursData ? hoursData.updateTime : null,
          week: weekData ? weekData.updateTime : null,
        },
        hours: hoursData ? hoursData.forecasts : [],
        week: weekData ? weekData.forecasts : [],
      },
    };

    res.json(combined);
  } catch (error) {
    console.error("取得天氣資料失敗:", error);

    if (error.response) {
      return res.status(error.response.status).json({
        error: "CWA API 錯誤",
        message: error.response.data.message || "無法取得天氣資料",
        details: error.response.data,
      });
    }

    res.status(500).json({
      error: "伺服器錯誤",
      message: "無法取得天氣資料，請稍後再試",
    });
  }
};

// Routes
app.get("/", (req, res) => {
  res.json({
    message: "歡迎使用 CWA 天氣預報 API",
    endpoints: {
      weather: "/api/weather/:location",
      health: "/api/health",
    },
  });
});

app.get("/api/health", (req, res) => {
  res.json({
    status: "OK",
    timestamp: new Date().toISOString()
  });
});

// 取得指定縣市天氣預報（回傳合併的 36 小時與 7 天資料）
app.get("/api/weather/:location?", getCombinedWeather);


// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    error: "伺服器錯誤",
    message: err.message,
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: "找不到此路徑",
  });
});

app.listen(PORT, () => {
  console.log(`🚀 伺服器運行已運作`);
  console.log(`📍 環境: ${process.env.NODE_ENV || "development"}`);
});