const translations = {
    vi: {
        errorContent: 'Lỗi khi xuất dữ liệu, gửi lệnh hoặc thực hiện OTA. Vui lòng thử lại hoặc kiểm tra kết nối.',
        emgDescription: 'Toàn bộ giá trị EMG và phiên bản firmware được gửi mỗi 15 giây'
    },
    en: {
        errorContent: 'Error exporting data, sending command, or performing OTA. Please try again or check your connection.',
        emgDescription: 'All EMG values and firmware version are sent every 15 seconds'
    }
};

let currentLang = 'vi';

const dropboxInput = document.getElementById('dropboxLink');
const directInput = document.getElementById('directLink');
const payloadEl = document.getElementById('payload');
const brokerEl = document.getElementById('broker');
const topicEl = document.getElementById('topic');
const qosEl = document.getElementById('qos');
const otaStatusEl = document.getElementById('ota-status');
const otaLogEl = document.getElementById('ota-log');
let otaClient = null;

function otaLog(...args) {
    const txt = args.join(' ');
    otaLogEl.textContent += '\n' + txt;
    otaLogEl.scrollTop = otaLogEl.scrollHeight;
    console.log(...args);
}

function setOtaStatus(s) {
    otaStatusEl.textContent = translations[currentLang].emgDescription.includes('Status')
        ? `Status: ${s}`
        : `Trạng thái: ${s}`;
}

function convertDropboxLink(input) {
    try {
        const u = new URL(input.trim());
        if (u.hostname.includes('dl.dropboxusercontent.com')) {
            if (!u.protocol) u.protocol = 'https:';
            return u.toString();
        }
        if (u.hostname.includes('dropbox.com')) {
            const newUrl = new URL(u.toString());
            newUrl.hostname = 'dl.dropboxusercontent.com';
            newUrl.searchParams.delete('dl');
            newUrl.protocol = 'https:';
            return newUrl.toString();
        }
        return input;
    } catch (e) {
        return input;
    }
}

document.getElementById('convertBtn').addEventListener('click', () => {
    const inLink = dropboxInput.value.trim();
    if (!inLink) {
        alert(translations[currentLang].errorContent.includes('Please')
            ? 'Please paste a Dropbox share link first'
            : 'Vui lòng dán liên kết chia sẻ Dropbox trước');
        return;
    }
    const direct = convertDropboxLink(inLink);
    directInput.value = direct;
    try {
        const obj = { url: direct };
        payloadEl.value = JSON.stringify(obj, null, 2);
    } catch (e) {}
    otaLog(translations[currentLang].emgDescription.includes('Converted')
        ? 'Converted ->'
        : 'Đã chuyển đổi ->', direct);
});

document.getElementById('copyBtn').addEventListener('click', () => {
    if (!directInput.value) {
        alert(translations[currentLang].errorContent.includes('Please')
            ? 'Please convert first'
            : 'Vui lòng chuyển đổi trước');
        return;
    }
    navigator.clipboard.writeText(directInput.value).then(() => {
        otaLog(translations[currentLang].emgDescription.includes('Copied')
            ? 'Copied direct link to clipboard'
            : 'Đã sao chép liên kết trực tiếp vào bộ nhớ tạm');
    });
});

document.getElementById('connectBtn').addEventListener('click', () => {
    const broker = brokerEl.value.trim();
    if (!broker) {
        alert(translations[currentLang].errorContent.includes('Please')
            ? 'Please enter the WebSocket URL of the broker'
            : 'Vui lòng nhập URL WebSocket của máy chủ');
        return;
    }
    if (otaClient && otaClient.connected) {
        otaClient.end();
        otaClient = null;
        setOtaStatus(translations[currentLang].emgDescription.includes('disconnected')
            ? 'disconnected'
            : 'ngắt kết nối');
        otaLog(translations[currentLang].emgDescription.includes('Disconnected')
            ? 'Disconnected'
            : 'Đã ngắt kết nối');
        return;
    }
    otaLog(translations[currentLang].emgDescription.includes('Connecting')
        ? 'Connecting to'
        : 'Đang kết nối tới', broker);
    setOtaStatus(translations[currentLang].emgDescription.includes('connecting')
        ? 'connecting'
        : 'đang kết nối');
    try {
        otaClient = mqtt.connect(broker, { reconnectPeriod: 5000 });
        otaClient.on('connect', () => {
            setOtaStatus(translations[currentLang].emgDescription.includes('connected')
                ? 'connected'
                : 'đã kết nối');
            otaLog(translations[currentLang].emgDescription.includes('Connected')
                ? 'MQTT connected'
                : 'MQTT đã kết nối');
        });
        otaClient.on('reconnect', () => {
            setOtaStatus(translations[currentLang].emgDescription.includes('reconnecting')
                ? 'reconnecting'
                : 'đang kết nối lại');
            otaLog(translations[currentLang].emgDescription.includes('Reconnecting')
                ? 'MQTT reconnecting'
                : 'MQTT đang kết nối lại');
        });
        otaClient.on('error', (err) => {
            setOtaStatus(translations[currentLang].errorContent.includes('error')
                ? 'error'
                : 'lỗi');
            otaLog(translations[currentLang].errorContent.includes('Error')
                ? 'MQTT error'
                : 'Lỗi MQTT', err.message || err);
        });
        otaClient.on('close', () => {
            setOtaStatus(translations[currentLang].emgDescription.includes('closed')
                ? 'closed'
                : 'đã đóng');
            otaLog(translations[currentLang].emgDescription.includes('Closed')
                ? 'MQTT closed'
                : 'MQTT đã đóng');
        });
    } catch (e) {
        otaLog(translations[currentLang].errorContent.includes('Connection error')
            ? 'Connection error'
            : 'Lỗi kết nối', e.message);
        setOtaStatus(translations[currentLang].errorContent.includes('error')
            ? 'error'
            : 'lỗi');
    }
});

document.getElementById('publishBtn').addEventListener('click', () => {
    if (!otaClient || !otaClient.connected) {
        alert(translations[currentLang].errorContent.includes('not connected')
            ? 'MQTT not connected'
            : 'MQTT chưa được kết nối');
        return;
    }
    let topic = topicEl.value.trim();
    if (!topic) {
        alert(translations[currentLang].errorContent.includes('Please')
            ? 'Please enter a topic'
            : 'Vui lòng nhập topic');
        return;
    }
    let qos = parseInt(qosEl.value) || 0;
    let payload = payloadEl.value.trim();
    try {
        JSON.parse(payload);
    } catch (e) {
        alert(translations[currentLang].errorContent.includes('not valid JSON')
            ? 'Payload is not valid JSON'
            : 'Nội dung không phải JSON hợp lệ');
        return;
    }
    otaClient.publish(topic, payload, { qos: qos }, (err) => {
        if (err) {
            otaLog(translations[currentLang].errorContent.includes('Error')
                ? 'Publish error'
                : 'Lỗi gửi', err);
        } else {
            otaLog(translations[currentLang].emgDescription.includes('Published')
                ? 'Published to'
                : 'Đã gửi tới', topic, '\n', payload);
        }
    });
});

document.getElementById('close-ota').addEventListener('click', () => {
    window.location.href = 'index.html';
});

dropboxInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        document.getElementById('convertBtn').click();
        e.preventDefault();
    }
});