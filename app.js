const ccxt = require('ccxt');
const axios = require('axios');
const tulind = require('tulind');

// ปรับค่าตัวแปรที่นี่
const API_KEY = 'your-api-key';
const API_SECRET = 'your-api-secret';
const SYMBOL = 'BTC/USDT'; // เปลี่ยนตามคู่สกุลเงินที่คุณต้องการ
const MARGIN = 100; // มาร์จิ้นต่อคำสั่ง
const TP_DOLLAR = 20; // กำไรเป้าหมาย 20 ดอลลาร์
const SL_PERCENTAGE = 0.15; // ขาดทุนเป้าหมาย 15%
const TIMEFRAME = '5m'; // Timeframe 5 นาที
const LEVERAGE = 100; // เลเวอเรจ
const RSI_PERIOD = 14; // ระยะเวลา RSI
const RSI_OVERSOLD = 30; // ขีดจำกัด RSI ขายมากเกินไป
const RSI_OVERBOUGHT = 70; // ขีดจำกัด RSI ซื้อมากเกินไป
const NOTIFY_URL = 'https://your-notification-url.com'; // URL สำหรับการแจ้งเตือน

const exchange = new ccxt.binance({
    apiKey: API_KEY,
    secret: API_SECRET,
    enableRateLimit: true
});

const calculateMA = (data, period) => {
    const sum = data.slice(-period).reduce((acc, candle) => acc + candle[4], 0);
    return sum / period;
};

const calculateMACD = (data) => {
    const closes = data.map(candle => candle[4]);
    return new Promise((resolve, reject) => {
        tulind.indicators.macd.indicator([closes], [12, 26, 9], (err, results) => {
            if (err) return reject(err);
            resolve({
                macd: results[0],
                signal: results[1],
                histogram: results[2]
            });
        });
    });
};

const calculateRSI = (data, period) => {
    const closes = data.map(candle => candle[4]);
    return new Promise((resolve, reject) => {
        tulind.indicators.rsi.indicator([closes], [period], (err, results) => {
            if (err) return reject(err);
            resolve(results[0]);
        });
    });
};

const tradingSignal = async () => {
    // ดึงข้อมูลราคา
    const ohlcv = await exchange.fetchOHLCV(SYMBOL, TIMEFRAME);
    const lastPrice = ohlcv[ohlcv.length - 1][4];

    // คำนวณ MA5, MA20, MA50
    const ma5 = calculateMA(ohlcv, 5);
    const ma20 = calculateMA(ohlcv, 20);
    const ma50 = calculateMA(ohlcv, 50);

    // คำนวณ MACD
    const { macd, signal } = await calculateMACD(ohlcv);

    // คำนวณ RSI
    const rsi = await calculateRSI(ohlcv, RSI_PERIOD);

    // สัญญาณการซื้อขาย
    if (lastPrice > ma5 && lastPrice > ma20 && lastPrice > ma50 &&
        macd[macd.length - 1] > signal[signal.length - 1] &&
        rsi[rsi.length - 1] < RSI_OVERSOLD) {
        return 'buy';
    } else if (lastPrice < ma5 && lastPrice < ma20 && lastPrice < ma50 &&
               macd[macd.length - 1] < signal[signal.length - 1] &&
               rsi[rsi.length - 1] > RSI_OVERBOUGHT) {
        return 'sell';
    }
    return 'hold';
};

const hasOpenOrders = async () => {
    try {
        const openOrders = await exchange.fetchOpenOrders(SYMBOL);
        return openOrders.length > 0;
    } catch (error) {
        console.error('Error fetching open orders:', error);
        return false;
    }
};

const executeTrade = async (signal) => {
    if (await hasOpenOrders()) {
        console.log('Order already open, skipping new order.');
        return;
    }

    const price = await exchange.fetchTicker(SYMBOL);
    const lastPrice = price.last;
    let orderType = signal === 'buy' ? 'buy' : 'sell';
    const amount = (MARGIN * LEVERAGE) / lastPrice; // จำนวนที่ต้องซื้อขายตามมาร์จิ้นและเลเวอเรจ

    // การเปิดคำสั่งซื้อขาย
    const order = await exchange.createOrder(SYMBOL, 'market', orderType, amount, {
        'leverage': LEVERAGE
    });

    // คำนวณ TP และ SL
    const tpPrice = lastPrice + (TP_DOLLAR / amount); // คำนวณราคา TP เพื่อให้ได้กำไร 20 ดอลลาร์
    const slPrice = lastPrice * (1 - SL_PERCENTAGE);

    // ตั้งคำสั่ง TP และ SL
    await exchange.createOrder(SYMBOL, 'limit', orderType === 'buy' ? 'sell' : 'buy', amount, tpPrice);
    await exchange.createOrder(SYMBOL, 'stop_market', orderType === 'buy' ? 'sell' : 'buy', amount, {
        'stopPrice': slPrice
    });

    // ส่งการแจ้งเตือน
    await axios.post(NOTIFY_URL, {
        message: `Order ${orderType} executed at ${lastPrice}, TP at ${tpPrice}, SL at ${slPrice}`
    });
};

const trade = async () => {
    try {
        const signal = await tradingSignal();
        if (signal === 'buy' || signal === 'sell') {
            await executeTrade(signal);
        }
    } catch (error) {
        console.error('Error executing trade:', error);
    }
};

// เรียกใช้ฟังก์ชันทุก 5 นาที
setInterval(trade, 5 * 60 * 1000);
  
