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
const deviceIdEl = document.getElementById('deviceId');
const topicEl = document.getElementById('topic');
const qosEl = document.getElementById('qos');
const otaStatusEl = document.getElementById('ota-status');
const otaLogEl = document.getElementById('ota-log');
const deviceIdPreviewEl = document.getElementById('deviceId-preview');
let otaClient = null;

// Load device ID from localStorage
const savedDeviceId = localStorage.getItem('ota_deviceId');
if (savedDeviceId) {
    deviceIdEl.value = savedDeviceId;
}

// Store previous topic for unsubscribe
let previousTopic = '';

// Function to sanitize device ID (remove invalid MQTT topic characters)
function sanitizeDeviceId(deviceId) {
    // Remove or replace invalid characters: #, +, /, space
    return deviceId
        .replace(/[#+\/\s]/g, '_')  // Replace invalid chars with underscore
        .replace(/^_+|_+$/g, '')    // Remove leading/trailing underscores
        .replace(/_+/g, '_');        // Replace multiple underscores with single
}

// Function to update topic based on device ID
function updateTopic() {
    let deviceId = deviceIdEl.value.trim() || 'device01';
    
    // Sanitize device ID
    const sanitized = sanitizeDeviceId(deviceId);
    if (sanitized !== deviceId) {
        deviceId = sanitized;
        deviceIdEl.value = deviceId;
        otaLog('Device ID đã được làm sạch:', deviceId);
    }
    
    if (!deviceId) {
        deviceId = 'device01';
        deviceIdEl.value = deviceId;
    }
    
    const topic = `devices/${deviceId}/ota`;
    
    // If topic changed and we're connected, unsubscribe old topic and subscribe new one
    if (otaClient && otaClient.connected && previousTopic && previousTopic !== topic) {
        otaClient.unsubscribe(previousTopic, (err) => {
            if (err) {
                otaLog('Lỗi unsubscribe', previousTopic, err.message);
            } else {
                otaLog('Đã unsubscribe:', previousTopic);
            }
        });
    }
    
    topicEl.value = topic;
    deviceIdPreviewEl.textContent = deviceId;
    
    // Save to localStorage
    localStorage.setItem('ota_deviceId', deviceId);
    
    // If connected, subscribe to new topic
    if (otaClient && otaClient.connected) {
        otaClient.subscribe(topic, { qos: 0 }, (err) => {
            if (err) {
                otaLog('Lỗi subscribe', topic, err.message);
            } else {
                otaLog('Đã subscribe topic mới:', topic);
            }
        });
    }
    
    previousTopic = topic;
}

// Update topic when device ID changes
deviceIdEl.addEventListener('input', updateTopic);
deviceIdEl.addEventListener('change', updateTopic);

// Initialize topic on page load
updateTopic();

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
        const trimmed = input.trim();
        if (!trimmed) return input;
        
        const u = new URL(trimmed);
        
        // Already a direct download link
        if (u.hostname.includes('dl.dropboxusercontent.com')) {
            // Ensure https protocol
            if (u.protocol !== 'https:') {
                u.protocol = 'https:';
            }
            // Ensure dl=1 for direct download (remove other dl params first)
            u.searchParams.delete('dl');
            u.searchParams.set('dl', '1');
            
            const result = u.toString();
            otaLog('URL đã là direct link:', result.substring(0, 80) + '...');
            return result;
        }
        
        // Dropbox share link - convert to direct download
        if (u.hostname.includes('dropbox.com') || u.hostname.includes('www.dropbox.com')) {
            // Extract path (e.g., /scl/fi/xxxxx/file.bin or /s/xxxxx/file.bin)
            let path = u.pathname;
            
            // Handle /scl/fi/ format (new Dropbox format)
            if (path.includes('/scl/fi/')) {
                // Keep the path as is, just change hostname
                u.hostname = 'dl.dropboxusercontent.com';
            } 
            // Handle /s/ format (old Dropbox format)
            else if (path.startsWith('/s/')) {
                u.hostname = 'dl.dropboxusercontent.com';
            }
            // Default: try to convert
            else {
                u.hostname = 'dl.dropboxusercontent.com';
            }
            
            // Set protocol to https
            u.protocol = 'https:';
            
            // Preserve important query parameters (rlkey, st, etc.) but ensure dl=1
            // Remove old dl parameter if exists
            u.searchParams.delete('dl');
            u.searchParams.set('dl', '1');
            
            const result = u.toString();
            otaLog('Đã chuyển đổi từ share link sang direct link');
            return result;
        }
        
        // Not a Dropbox link, return as is (but validate it's HTTPS)
        if (u.protocol === 'https:') {
            return input;
        } else {
            otaLog('Cảnh báo: URL không phải HTTPS');
            return input;
        }
    } catch (e) {
        otaLog('Lỗi chuyển đổi link:', e.message);
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
    
    // Validate converted URL
    if (!direct || direct === inLink) {
        // Check if it's already a valid HTTPS URL
        try {
            const urlObj = new URL(inLink);
            if (urlObj.protocol === 'https:') {
                directInput.value = inLink;
                const obj = { url: inLink };
                payloadEl.value = JSON.stringify(obj, null, 2);
                otaLog('URL đã hợp lệ (HTTPS):', inLink);
                return;
            }
        } catch (e) {
            // Not a valid URL
        }
        
        alert('Không thể chuyển đổi link. Vui lòng kiểm tra lại link Dropbox.\n\nLink phải là:\n- Dropbox share link (dropbox.com/scl/fi/...)\n- Hoặc direct download link (dl.dropboxusercontent.com/...)');
        otaLog('Lỗi: Không thể chuyển đổi link');
        return;
    }
    
    // Validate the converted URL is HTTPS
    try {
        const urlObj = new URL(direct);
        if (urlObj.protocol !== 'https:') {
            alert('Cảnh báo: URL sau khi chuyển đổi không phải HTTPS.\nURL: ' + direct);
            otaLog('Cảnh báo: URL không phải HTTPS:', direct);
        }
    } catch (e) {
        alert('Lỗi: URL sau khi chuyển đổi không hợp lệ.\n' + e.message);
        otaLog('Lỗi: URL không hợp lệ sau khi chuyển đổi:', e.message);
        return;
    }
    
    directInput.value = direct;
    try {
        const obj = { url: direct };
        payloadEl.value = JSON.stringify(obj, null, 2);
        otaLog(translations[currentLang].emgDescription.includes('Converted')
            ? 'Converted ->'
            : 'Đã chuyển đổi ->', direct);
        otaLog('Payload đã được cập nhật với URL mới');
    } catch (e) {
        otaLog('Lỗi tạo payload:', e.message);
    }
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
            
            // Subscribe to OTA feedback topics
            const feedbackTopic = topicEl.value.trim() || 'devices/device01/ota';
            const generalOtaTopic = 'ota';
            
            previousTopic = feedbackTopic; // Store for future unsubscribe
            
            otaClient.subscribe(feedbackTopic, { qos: 0 }, (err) => {
                if (err) {
                    otaLog('Lỗi subscribe', feedbackTopic, err.message);
                } else {
                    otaLog('Đã subscribe:', feedbackTopic);
                }
            });
            
            otaClient.subscribe(generalOtaTopic, { qos: 0 }, (err) => {
                if (err) {
                    otaLog('Lỗi subscribe', generalOtaTopic, err.message);
                } else {
                    otaLog('Đã subscribe:', generalOtaTopic);
                }
            });
        });
        
        // Listen for OTA status messages
        otaClient.on('message', (topic, message) => {
            try {
                const payload = message.toString();
                otaLog('Nhận từ', topic + ':', payload);
                
                // Try to parse as JSON
                try {
                    const obj = JSON.parse(payload);
                    if (obj.status) {
                        if (obj.status === 'downloading') {
                            setOtaStatus('Đang tải xuống...');
                            otaLog('OTA: Đang tải xuống firmware...');
                        } else if (obj.status === 'success') {
                            setOtaStatus('OTA thành công!');
                            otaLog('OTA: Cập nhật thành công! ESP32 sẽ khởi động lại.');
                        } else if (obj.status === 'failed') {
                            setOtaStatus('OTA thất bại');
                            otaLog('OTA: Thất bại -', obj.error || 'Unknown error');
                            if (obj.code) {
                                otaLog('Mã lỗi:', obj.code);
                            }
                        } else if (obj.status === 'no_updates') {
                            setOtaStatus('Không có bản cập nhật');
                            otaLog('OTA: Không có bản cập nhật');
                        }
                    }
                } catch (e) {
                    // Not JSON, just log as text
                    otaLog('Message:', payload);
                }
            } catch (e) {
                otaLog('Lỗi xử lý message:', e.message);
            }
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
    
    // Validate JSON format
    let payloadObj;
    try {
        payloadObj = JSON.parse(payload);
    } catch (e) {
        alert(translations[currentLang].errorContent.includes('not valid JSON')
            ? 'Payload is not valid JSON: ' + e.message
            : 'Nội dung không phải JSON hợp lệ: ' + e.message);
        otaLog('Lỗi parse JSON:', e.message);
        return;
    }
    
    // Validate URL in payload
    if (!payloadObj.url || typeof payloadObj.url !== 'string') {
        alert('Payload phải chứa trường "url" là chuỗi hợp lệ.\nVui lòng chuyển đổi Dropbox link trước.');
        otaLog('Lỗi: Payload thiếu URL hoặc URL không hợp lệ');
        return;
    }
    
    const url = payloadObj.url.trim();
    if (!url) {
        alert('URL không được để trống.\nVui lòng chuyển đổi Dropbox link trước.');
        otaLog('Lỗi: URL rỗng');
        return;
    }
    
    // Validate URL format
    try {
        const urlObj = new URL(url);
        if (urlObj.protocol !== 'https:') {
            alert('URL phải sử dụng HTTPS.\nURL hiện tại: ' + urlObj.protocol);
            otaLog('Lỗi: URL không phải HTTPS:', url);
            return;
        }
        
        // Check if it's a Dropbox direct link
        if (!urlObj.hostname.includes('dl.dropboxusercontent.com') && 
            !urlObj.hostname.includes('dropbox.com')) {
            otaLog('Cảnh báo: URL không phải Dropbox link');
        }
    } catch (e) {
        alert('URL không hợp lệ: ' + e.message + '\nURL: ' + url);
        otaLog('Lỗi: URL không hợp lệ:', e.message, url);
        return;
    }
    
    // Re-stringify to ensure clean JSON (compact format, no spaces)
    const cleanPayload = JSON.stringify({ url: url });
    
    otaLog('═══════════════════════════════════');
    otaLog('Đang gửi OTA command...');
    otaLog('Topic:', topic);
    otaLog('URL:', url);
    otaLog('URL length:', url.length);
    otaLog('Payload:', cleanPayload);
    otaLog('Payload length:', cleanPayload.length);
    otaLog('QoS:', qos);
    
    // Log payload preview for debugging
    const payloadPreview = cleanPayload.length > 150 
        ? cleanPayload.substring(0, 150) + '...' 
        : cleanPayload;
    otaLog('Payload preview:', payloadPreview);
    
    otaClient.publish(topic, cleanPayload, { qos: qos }, (err) => {
        if (err) {
            otaLog(translations[currentLang].errorContent.includes('Error')
                ? 'Publish error'
                : 'Lỗi gửi', err);
            setOtaStatus('Lỗi gửi');
        } else {
            otaLog(translations[currentLang].emgDescription.includes('Published')
                ? 'Published to'
                : '✅ Đã gửi tới', topic);
            otaLog('Payload đã gửi:', cleanPayload);
            setOtaStatus('Đã gửi OTA command, đang chờ phản hồi...');
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