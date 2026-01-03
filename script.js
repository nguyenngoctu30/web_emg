document.addEventListener('DOMContentLoaded', () => {
    // Kiểm tra xem Chart.js có được tải không
    if (typeof Chart === 'undefined') {
        console.error('Chart.js is not loaded');
        document.getElementById('error-content').textContent = 'Lỗi: Chart.js chưa được tải. Vui lòng kiểm tra kết nối hoặc tệp HTML.';
        document.getElementById('error-modal').classList.remove('hidden');
        return;
    }

    // Cấu hình MQTT
    const mqttBroker = 'broker.hivemq.com';
    const mqttPort = 8884;
    const mqttTopic = 'servo/angle';
    const mqttEMATopic = 'servo/ema';
    const mqttThresholdLowTopic = 'servo/threshold_low';
    const mqttThresholdHighTopic = 'servo/threshold_high';
    const mqttCmdTopic = 'servo/cmd';
    const mqttOtaTopic = 'ota';
    const mqttTrainTopic = 'train';
    const clientId = 'web_client_' + Math.random().toString(16).substr(2, 8);

    // Cấu hình ThingSpeak
    const thingspeakChannelId = '2629822';
    const thingspeakReadApiKey = 'YWETKVEKPQQXSV75';
    const thingspeakApiUrl = `https://api.thingspeak.com/channels/${thingspeakChannelId}/feeds.json?api_key=${thingspeakReadApiKey}&results=8000`;

    // Tham chiếu đến các phần tử DOM
    const handStateElement = document.getElementById('hand-state');
    const handImageElement = document.getElementById('hand-image');
    const connectionStatusElement = document.getElementById('connection-status');
    const transitionCountElement = document.getElementById('transition-count');
    const trainingStatusElement = document.getElementById('training-status');
    const trainingTimerElement = document.getElementById('training-timer');
    const thresholdLowElement = document.getElementById('threshold-low');
    const thresholdHighElement = document.getElementById('threshold-high');
    const firmwareVersionElement = document.getElementById('firmware-version');
    // Some HTML uses id="ema-line" for displaying S1/S2 EMA — fall back to legacy id 'filtered-line'
    const filteredLineElement = document.getElementById('ema-line') || document.getElementById('filtered-line');
    
    // Safe setter to avoid errors if old elements are missing
    function safeSet(el, text) {
        try { 
            if (el) el.textContent = text; 
        } catch (e) { 
            console.warn('safeSet failed', e); 
        }
    }
    
    const loadingSpinner = document.getElementById('loading-spinner');
    const timeFilter = document.getElementById('time-filter');

    // Dữ liệu đa ngôn ngữ
    const translations = {
        vi: {
            mainTitle: 'ỨNG DỤNG CẢM BIẾN EMG VÀO ĐIỀU KHIỂN CÁNH TAY MÁY TỪ XA',
            mainDescription: 'Giao diện thời gian thực để theo dõi và điều khiển cánh tay robot bằng cảm biến EMG',
            connectionLabel: 'Trạng thái kết nối:',
            transitionCount: 'Tổng chuyển đổi',
            trainingStatus: 'Trạng thái huấn luyện',
            trainingTimer: 'Thời gian còn lại',
            thresholdLow: 'Ngưỡng thấp',
            thresholdHigh: 'Ngưỡng cao',
            firmwareVersion: 'Phiên bản phần mềm',
            filteredValue: 'Giá trị đã lọc',
            trainButton: 'Bắt đầu quá trình huấn luyện 📈',
            resetButton: 'Đặt lại ngưỡng ban đầu 🔄',
            firmwareButton: 'Cập nhật phần mềm ⚙️',
            emgTitle: 'Dữ liệu EMG',
            emgDescription: 'Giá trị EMG được gửi mỗi 15 giây',
            guideTitle: 'Hướng dẫn sử dụng',
            guideContent: `- Đây là giao diện để theo dõi và điều khiển cánh tay robot qua cảm biến EMG.<br>
                - <strong>Điện cơ đồ (EMG)</strong>: Kỹ thuật đánh giá hoạt động điện của cơ xương.<br>
                - <strong>Biểu đồ trạng thái tay</strong>: Hiển thị lịch sử trạng thái tay (mở/nắm) theo thời gian thực.<br>
                - <strong>Biểu đồ EMG</strong>: Hiển thị dữ liệu EMG từ ThingSpeak, cập nhật mỗi 15 giây.<br>
                - <strong>s1_filtered & s2_filtered</strong>: Giá trị đã lọc từ cảm biến EMG.<br>
                - <strong>Ngưỡng</strong>: Giá trị ngưỡng từ huấn luyện K-Means.<br>
                - <strong>Huấn luyện</strong>: Nhấn "Bắt đầu huấn luyện" để khởi động (60 giây).<br>
                - <strong>Đặt lại ngưỡng</strong>: Nhấn để khôi phục ngưỡng mặc định.<br>
                - <strong>Firmware</strong>: Nhấn để cập nhật OTA qua liên kết Dropbox.<br>
                - <strong>Kết nối</strong>: Đảm bảo cảm biến kết nối với MQTT broker (broker.hivemq.com, port 1883).<br>
                - Sử dụng bộ lọc thời gian để xem dữ liệu.<br>
                - Nhấn "Xuất dữ liệu" để tải file Excel.`,
            fontSmall: 'Chữ nhỏ',
            fontMedium: 'Chữ trung bình',
            fontLarge: 'Chữ lớn',
            langVi: 'Tiếng Việt 🇻🇳',
            langEn: 'English 🇱🇷',
            zoomInHand: 'Phóng to 🔎',
            zoomOutHand: 'Thu nhỏ 🔍',
            zoomInEmg: 'Phóng to 🔎',
            zoomOutEmg: 'Thu nhỏ 🔍',
            exportEmg: 'Xuất dữ liệu (XLS)',
            guideButton: 'Hướng dẫn',
            closeGuide: 'Đóng',
            errorTitle: 'Lỗi',
            errorContent: 'Lỗi khi xuất dữ liệu, gửi lệnh hoặc thực hiện OTA. Vui lòng thử lại hoặc kiểm tra kết nối.',
            trainingNotStarted: 'Chưa bắt đầu',
            trainingInProgress: 'Đang huấn luyện...',
            trainingCompleted: 'Huấn luyện hoàn tất',
            noData: 'Chưa có dữ liệu',
            connected: 'Đã kết nối',
            reconnecting: 'Đang kết nối lại...',
            connectionFailed: 'Kết nối thất bại',
            disconnected: 'Mất kết nối',
            handOpen: 'Tay: Mở',
            handClose: 'Tay: Nắm',
            time: 'Thời gian'
        },
        en: {
            mainTitle: 'Hand Gesture Control via EMG',
            mainDescription: 'Real-time interface for monitoring and controlling a robotic arm using EMG sensors',
            connectionLabel: 'Connection Status:',
            transitionCount: 'Total Transitions',
            trainingStatus: 'Training Status',
            trainingTimer: 'Time Remaining',
            thresholdLow: 'Low Threshold',
            thresholdHigh: 'High Threshold',
            firmwareVersion: 'Firmware Version',
            filteredValue: 'Filtered Value',
            trainButton: 'Start Training',
            resetButton: 'Reset Thresholds',
            firmwareButton: 'Firmware',
            emgTitle: 'EMG Data from ThingSpeak',
            emgDescription: 'EMG values are sent every 15 seconds',
            guideTitle: 'User Guide',
            guideContent: `- This is an interface for monitoring and controlling a robotic arm using EMG sensors.<br>
                - <strong>Hand State Chart</strong>: Displays the history of hand states (open/close) in real-time.<br>
                - <strong>EMG Chart</strong>: Shows EMG data from ThingSpeak, updated every 15 seconds.<br>
                - <strong>s1_filtered & s2_filtered</strong>: Filtered values from EMG sensors.<br>
                - <strong>Thresholds</strong>: Displays threshold values from K-Means training.<br>
                - <strong>Training</strong>: Click "Start Training" to initiate (60 seconds).<br>
                - <strong>Reset Thresholds</strong>: Click to restore default thresholds.<br>
                - <strong>Firmware</strong>: Click to update OTA via Dropbox link.<br>
                - <strong>Connection</strong>: Ensure sensor is connected to MQTT broker (broker.hivemq.com, port 1883).<br>
                - Use the time filter to view data.<br>
                - Click "Export Data" to download Excel file.`,
            fontSmall: 'Small Font',
            fontMedium: 'Medium Font',
            fontLarge: 'Large Font',
            langVi: 'Vietnamese',
            langEn: 'English',
            zoomInHand: 'Zoom In',
            zoomOutHand: 'Zoom Out',
            zoomInEmg: 'Zoom In',
            zoomOutEmg: 'Zoom Out',
            exportEmg: 'Export Data (XLS)',
            guideButton: 'Guide',
            closeGuide: 'Close',
            errorTitle: 'Error',
            errorContent: 'Error exporting data, sending command, or performing OTA. Please try again or check your connection.',
            trainingNotStarted: 'Not Started',
            trainingInProgress: 'Training in Progress...',
            trainingCompleted: 'Training Completed',
            noData: 'No data',
            connected: 'Connected',
            reconnecting: 'Reconnecting...',
            connectionFailed: 'Connection failed',
            disconnected: 'Disconnected',
            handOpen: 'Hand: Open',
            handClose: 'Hand: Close',
            time: 'Time'
        }
    };

    let currentLang = 'vi';
    // Default training duration in seconds (keeps web and device in sync)
    const TRAINING_DURATION = 30;
    let trainingStatus = translations[currentLang].trainingNotStarted;
    let trainingTimer = TRAINING_DURATION;
    let filteredData = [];
    let thresholdLowValue = null;
    let thresholdHighValue = null;
    let firmwareVersion = null; // MQTT-sourced firmware version
    let currentFiltered1 = null;
    let currentFiltered2 = null;
    let trainingInterval = null;
    let transitionCount = 0;
    let emgData = [];
    let zoomLevels = { 'hand-chart': 1, 'emg-chart': 1 };

    // Hàm chuyển đổi ngôn ngữ
    function setLanguage(lang) {
        currentLang = lang;
        const t = translations[lang];
        
        // Cập nhật text content
        document.getElementById('main-title').textContent = t.mainTitle;
        document.getElementById('main-description').textContent = t.mainDescription;
        document.getElementById('connection-label').textContent = t.connectionLabel;
        document.getElementById('transition-count').textContent = `${t.transitionCount}: ${transitionCount}`;
        document.getElementById('training-status').textContent = `${t.trainingStatus}: ${trainingStatus}`;
        document.getElementById('training-timer').textContent = trainingTimer > 0 ? `${t.trainingTimer}: ${trainingTimer}s` : '';
        document.getElementById('threshold-low').textContent = `${t.thresholdLow}: ${thresholdLowValue !== null ? thresholdLowValue : t.noData}`;
        document.getElementById('threshold-high').textContent = `${t.thresholdHigh}: ${thresholdHighValue !== null ? thresholdHighValue : t.noData}`;
        document.getElementById('firmware-version').textContent = `${t.firmwareVersion}: ${firmwareVersion !== null ? firmwareVersion : t.noData}`;
        
        // Display s1_filtered/s2_filtered live values
        if (currentFiltered1 !== null && currentFiltered2 !== null) {
            safeSet(filteredLineElement, `S1_EMA: ${currentFiltered1.toFixed(2)} | S2_EMA: ${currentFiltered2.toFixed(2)}`);
        } else if (currentFiltered1 !== null) {
            safeSet(filteredLineElement, `S1_EMA: ${currentFiltered1.toFixed(2)} | S2_EMA: ${t.noData}`);
        } else {
            safeSet(filteredLineElement, `S1_EMA: ${t.noData} | S2_EMA: ${t.noData}`);
        }
        
        document.getElementById('train-button').textContent = t.trainButton;
        document.getElementById('reset-button').textContent = t.resetButton;
        document.getElementById('firmware-button').textContent = t.firmwareButton;
        document.getElementById('emg-title').textContent = t.emgTitle;
        document.getElementById('emg-description').textContent = t.emgDescription;
        document.getElementById('guide-title').textContent = t.guideTitle;
        document.getElementById('guide-content').innerHTML = t.guideContent;
        document.getElementById('font-small').textContent = t.fontSmall;
        document.getElementById('font-medium').textContent = t.fontMedium;
        document.getElementById('font-large').textContent = t.fontLarge;
        document.getElementById('lang-vi').textContent = t.langVi;
        document.getElementById('lang-en').textContent = t.langEn;
        document.getElementById('zoom-in-hand').textContent = t.zoomInHand;
        document.getElementById('zoom-out-hand').textContent = t.zoomOutHand;
        document.getElementById('zoom-in-emg').textContent = t.zoomInEmg;
        document.getElementById('zoom-out-emg').textContent = t.zoomOutEmg;
        document.getElementById('export-emg').textContent = t.exportEmg;
        document.getElementById('guide-button').textContent = t.guideButton;
        document.getElementById('close-guide').textContent = t.closeGuide;
        document.getElementById('error-title').textContent = t.errorTitle;
        document.getElementById('error-content').textContent = t.errorContent;
        document.getElementById('close-error').textContent = t.closeGuide;

        // Cập nhật time filter
        timeFilter.options[0].textContent = lang === 'vi' ? 'Tất cả' : 'All';
        timeFilter.options[1].textContent = lang === 'vi' ? '1 giờ' : '1 hour';
        timeFilter.options[2].textContent = lang === 'vi' ? '1 ngày' : '1 day';

        // Cập nhật biểu đồ
        updateChartTranslations();
    }

    // Hàm cập nhật ngôn ngữ cho biểu đồ
    function updateChartTranslations() {
        const t = translations[currentLang];
        
        // Cập nhật Hand Chart
        handChart.options.plugins.title.text = t.transitionCount;
        handChart.options.scales.x.title.text = t.time;
        handChart.options.scales.y.ticks.callback = value => 
            value === 0 ? (currentLang === 'vi' ? 'Mở' : 'Open') : 
            value === 1 ? (currentLang === 'vi' ? 'Nắm' : 'Close') : '';
        
        handChart.options.plugins.tooltip.callbacks.label = context => 
            context.parsed.y === 0 ? t.handOpen : t.handClose;

        // Cập nhật EMG Chart
        emgChart.options.plugins.title.text = t.emgTitle;
        emgChart.options.scales.y.title.text = 'Value';
        emgChart.options.scales.x.title.text = t.time;
        emgChart.data.datasets[0].label = 's1_filtered';
        if (emgChart.data.datasets[1]) emgChart.data.datasets[1].label = 's2_filtered';
        
        handChart.update();
        emgChart.update();
    }

    // Hàm thay đổi kích thước chữ
    function changeFontSize(size) {
        const sizes = {
            small: '12px',
            medium: '14px',
            large: '16px'
        };
        document.body.style.fontSize = sizes[size] || '14px';
    }

    // Hàm hiển thị/ẩn modal
    function openGuideModal() {
        document.getElementById('guide-modal').classList.remove('hidden');
    }

    function closeGuideModal() {
        document.getElementById('guide-modal').classList.add('hidden');
    }

    function openErrorModal() {
        document.getElementById('error-modal').classList.remove('hidden');
    }

    function closeErrorModal() {
        document.getElementById('error-modal').classList.add('hidden');
    }

    // Hàm bắt đầu huấn luyện
    function startTraining() {
        if (!(client && client.connected)) {
            openErrorModal();
            console.error('Cannot start training: MQTT client not connected');
            return;
        }
        const t = translations[currentLang];
        trainingStatus = t.trainingInProgress;
        trainingStatusElement.textContent = `${t.trainingStatus}: ${trainingStatus}`;
        trainingTimer = TRAINING_DURATION;
        trainingTimerElement.textContent = `${t.trainingTimer}: ${trainingTimer}s`;
        trainingTimerElement.classList.remove('hidden');

        // Send start command to device
        // publish JSON with duration so ESP can use the same training window
        try {
            client.publish(mqttTrainTopic, JSON.stringify({ cmd: 'start', duration: TRAINING_DURATION }));
        } catch (e) {
            client.publish(mqttTrainTopic, 'start');
        }
        
        // countdown UI for visual feedback
        if (trainingInterval) clearInterval(trainingInterval);
        trainingInterval = setInterval(() => {
            trainingTimer--;
            trainingTimerElement.textContent = `${t.trainingTimer}: ${trainingTimer}s`;
            if (trainingTimer <= 0) {
                clearInterval(trainingInterval);
                trainingTimerElement.classList.add('hidden');
            }
        }, 1000);
    }

    // Hàm đặt lại ngưỡng
    function resetThresholds() {
        const DEFAULT_LOW = 10;
        const DEFAULT_HIGH = 15;
        if (client && client.connected) {
            console.log('Publishing reset_threshold to broker...');
            client.publish(mqttCmdTopic, 'reset_threshold', { qos: 0 });
            client.publish(mqttTrainTopic, JSON.stringify({ cmd: 'reset_threshold' }));
            client.publish(mqttThresholdLowTopic, String(DEFAULT_LOW));
            client.publish(mqttThresholdHighTopic, String(DEFAULT_HIGH));
            thresholdLowValue = DEFAULT_LOW;
            thresholdHighValue = DEFAULT_HIGH;
            thresholdLowElement.textContent = `${translations[currentLang].thresholdLow}: ${thresholdLowValue}`;
            thresholdHighElement.textContent = `${translations[currentLang].thresholdHigh}: ${thresholdHighValue}`;
            console.log('Sent reset_threshold and updated UI to defaults');
        } else {
            openErrorModal();
            console.error('Cannot reset thresholds: MQTT client not connected');
        }
    }

    // Khởi tạo biểu đồ Hand Chart
    const handCtx = document.getElementById('hand-chart').getContext('2d');
    const handChart = new Chart(handCtx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [{
                label: 'Hand State',
                data: [],
                borderColor: '#3b82f6',
                backgroundColor: 'rgba(59, 130, 246, 0.2)',
                fill: true,
                tension: 0.4,
                pointRadius: 4,
                pointHoverRadius: 6,
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                title: { 
                    display: true, 
                    text: translations[currentLang].transitionCount,
                    font: { size: 16, family: 'Inter' },
                    color: '#111827',
                    padding: { top: 10, bottom: 20 }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return context.parsed.y === 0 ? 
                                translations[currentLang].handOpen : 
                                translations[currentLang].handClose;
                        }
                    }
                }
            },
            scales: {
                y: {
                    min: -0.5,
                    max: 1.5,
                    ticks: {
                        stepSize: 1,
                        callback: function(value) {
                            return value === 0 ? 
                                (currentLang === 'vi' ? 'Mở' : 'Open') : 
                                value === 1 ? 
                                (currentLang === 'vi' ? 'Nắm' : 'Close') : '';
                        },
                        color: '#111827',
                        font: { size: 12 }
                    },
                    grid: { color: 'rgba(0, 0, 0, 0.05)' },
                    title: {
                        display: true,
                        text: 'Trạng thái',
                        color: '#111827'
                    }
                },
                x: { 
                    ticks: { 
                        maxTicksLimit: 10, 
                        color: '#111827', 
                        font: { size: 11 } 
                    },
                    title: { 
                        display: true, 
                        text: translations[currentLang].time,
                        font: { size: 12 }, 
                        color: '#111827' 
                    },
                    grid: { color: 'rgba(0, 0, 0, 0.05)' }
                }
            },
            onClick: (e, elements) => {
                if (elements.length) {
                    const index = elements[0].index;
                    const value = handChart.data.datasets[0].data[index];
                    const label = handChart.data.labels[index];
                    const state = value === 0 ? 
                        translations[currentLang].handOpen : 
                        translations[currentLang].handClose;
                    alert(`${translations[currentLang].transitionCount}: ${state} (${label})`);
                }
            }
        }
    });

    // Khởi tạo biểu đồ EMG Chart
    const emgCtx = document.getElementById('emg-chart').getContext('2d');
    const emgChart = new Chart(emgCtx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [{
                label: 's1_filtered',
                data: [],
                borderColor: '#10b981',
                backgroundColor: 'rgba(16, 185, 129, 0.1)',
                fill: true,
                tension: 0.3,
                pointRadius: 2,
                pointHoverRadius: 4,
                borderWidth: 2
            }, {
                label: 's2_filtered',
                data: [],
                borderColor: '#ef4444',
                backgroundColor: 'rgba(239, 68, 68, 0.08)',
                fill: true,
                tension: 0.3,
                pointRadius: 2,
                pointHoverRadius: 4,
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { 
                    display: true, 
                    position: 'top', 
                    labels: { 
                        color: '#111827', 
                        font: { size: 12 },
                        usePointStyle: true
                    } 
                },
                title: { 
                    display: true, 
                    text: translations[currentLang].emgTitle,
                    font: { size: 16, family: 'Inter' },
                    color: '#111827',
                    padding: { top: 10, bottom: 20 }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const y = context.parsed.y;
                            return `${context.dataset.label}: ${isNaN(y) ? 'N/A' : y.toFixed(2)}`;
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    title: { 
                        display: true, 
                        text: 'Value',
                        font: { size: 12 }, 
                        color: '#111827' 
                    },
                    ticks: { 
                        color: '#111827', 
                        font: { size: 11 } 
                    },
                    grid: { color: 'rgba(0, 0, 0, 0.05)' }
                },
                x: { 
                    ticks: { 
                        maxTicksLimit: 8, 
                        color: '#111827', 
                        font: { size: 11 } 
                    },
                    title: { 
                        display: true, 
                        text: translations[currentLang].time,
                        font: { size: 12 }, 
                        color: '#111827' 
                    },
                    grid: { color: 'rgba(0, 0, 0, 0.05)' }
                }
            },
            onClick: (e, elements) => {
                if (elements.length) {
                    const index = elements[0].index;
                    const datasetIndex = elements[0].datasetIndex;
                    const value = emgChart.data.datasets[datasetIndex].data[index];
                    const label = emgChart.data.labels[index];
                    alert(`${emgChart.data.datasets[datasetIndex].label}: ${value.toFixed(2)} (${label})`);
                }
            }
        }
    });

    // Hàm phóng to/thu nhỏ biểu đồ
    function zoomChart(chartId, factor) {
        const canvas = document.getElementById(chartId);
        zoomLevels[chartId] = (zoomLevels[chartId] || 1) * factor;
        zoomLevels[chartId] = Math.min(Math.max(zoomLevels[chartId], 0.5), 3);
        canvas.style.transform = `scale(${zoomLevels[chartId]})`;
        canvas.style.transformOrigin = 'center center';
    }

    // Hàm cập nhật biểu đồ EMG từ ThingSpeak
    async function updateEMGChart(url = thingspeakApiUrl) {
        if (typeof emgChart === 'undefined') {
            console.error('emgChart is not defined, skipping update');
            document.getElementById('error-content').textContent = 'Lỗi: Biểu đồ EMG chưa được khởi tạo.';
            openErrorModal();
            return;
        }

        try {
            loadingSpinner.classList.remove('hidden');
            const response = await fetch(url);
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            
            const data = await response.json();
            emgData = data.feeds || [];

            emgChart.data.labels = [];
            emgChart.data.datasets[0].data = [];
            if (emgChart.data.datasets[1]) emgChart.data.datasets[1].data = [];

            emgData.forEach(feed => {
                if (feed.created_at) {
                    const timestamp = new Date(feed.created_at);
                    const formattedTime = timestamp.toLocaleString(currentLang === 'vi' ? 'vi-VN' : 'en-US', {
                        year: 'numeric',
                        month: '2-digit',
                        day: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit'
                    });
                    emgChart.data.labels.push(formattedTime);
                } else {
                    emgChart.data.labels.push('');
                }

                const v1 = (feed.field1 !== undefined && feed.field1 !== null) ? parseFloat(feed.field1) : NaN;
                const v2 = (feed.field2 !== undefined && feed.field2 !== null) ? parseFloat(feed.field2) : NaN;
                emgChart.data.datasets[0].data.push(isNaN(v1) ? NaN : v1);
                if (emgChart.data.datasets[1]) emgChart.data.datasets[1].data.push(isNaN(v2) ? NaN : v2);
            });

            emgChart.update();
            console.log(`Updated EMG chart with ${emgData.length} data points from ThingSpeak`);
        } catch (error) {
            console.error('Error fetching ThingSpeak data:', error);
            document.getElementById('error-content').textContent = `Lỗi khi tải dữ liệu từ ThingSpeak: ${error.message}`;
            openErrorModal();
        } finally {
            loadingSpinner.classList.add('hidden');
        }
    }

    // Hàm xuất dữ liệu EMG sang Excel
    function exportEMGData() {
        if (typeof XLSX === 'undefined' || typeof saveAs === 'undefined') {
            document.getElementById('error-content').textContent = 'Lỗi: Thư viện XLSX hoặc FileSaver chưa được tải.';
            openErrorModal();
            console.error('XLSX or FileSaver library not loaded');
            return;
        }

        if (!emgData || emgData.length === 0) {
            document.getElementById('error-content').textContent = 'Lỗi: Không có dữ liệu EMG để xuất.';
            openErrorModal();
            console.error('No EMG data available to export');
            return;
        }

        try {
            const t = translations[currentLang];
            const wsData = [
                [t.time, 's1_filtered', 's2_filtered', 'Firmware Version']
            ];

            emgData.forEach(feed => {
                const timestamp = feed.created_at ? new Date(feed.created_at) : null;
                const formattedTime = timestamp ? timestamp.toLocaleString(currentLang === 'vi' ? 'vi-VN' : 'en-US') : '';
                const v1 = (feed.field1 !== undefined && feed.field1 !== null) ? parseFloat(feed.field1) : '';
                const v2 = (feed.field2 !== undefined && feed.field2 !== null) ? parseFloat(feed.field2) : '';
                wsData.push([
                    formattedTime,
                    v1,
                    v2,
                    feed.field3 || 'N/A'
                ]);
            });

            const ws = XLSX.utils.aoa_to_sheet(wsData);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'Filtered Data');
            const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
            saveAs(new Blob([wbout], { type: 'application/octet-stream' }), `filtered_data_${new Date().toISOString().split('T')[0]}.xlsx`);
        } catch (error) {
            document.getElementById('error-content').textContent = `Lỗi khi xuất dữ liệu Excel: ${error.message}`;
            openErrorModal();
            console.error('Error exporting XLSX:', error);
        }
    }

    // Xử lý sự kiện bộ lọc thời gian
    timeFilter.addEventListener('change', async () => {
        let url = thingspeakApiUrl;
        const now = new Date();

        if (timeFilter.value === '1h') {
            const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
            url = `https://api.thingspeak.com/channels/${thingspeakChannelId}/feeds.json?api_key=${thingspeakReadApiKey}&start=${oneHourAgo}&results=8000`;
        } else if (timeFilter.value === '1d') {
            const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
            url = `https://api.thingspeak.com/channels/${thingspeakChannelId}/feeds.json?api_key=${thingspeakReadApiKey}&start=${oneDayAgo}&results=8000`;
        }

        await updateEMGChart(url);
    });

    // Kết nối MQTT
    const client = mqtt.connect(`wss://${mqttBroker}:${mqttPort}/mqtt`, {
        clientId,
        reconnectPeriod: 5000,
        keepalive: 30,
        clean: true
    });

    client.on('connect', () => {
        console.log('Connected to MQTT broker');
        const t = translations[currentLang];
        handStateElement.textContent = t.connected;
        connectionStatusElement.classList.remove('bg-red-500', 'bg-yellow-500');
        connectionStatusElement.classList.add('bg-green-500');
        connectionStatusElement.setAttribute('aria-label', t.connected);

        // Subscribe to topics
        const topics = [
            mqttTopic,
            mqttEMATopic,
            mqttThresholdLowTopic,
            mqttThresholdHighTopic,
            mqttCmdTopic,
            mqttOtaTopic,
            mqttTrainTopic
        ];

        topics.forEach(topic => {
            client.subscribe(topic, (err) => {
                if (err) {
                    console.error(`Subscription failed for ${topic}:`, err);
                } else {
                    console.log(`Subscribed to topic: ${topic}`);
                }
            });
        });
        
        client.publish('servo/cmd', 'ping_ui');
    });

    client.on('reconnect', () => {
        console.log('Reconnecting to MQTT broker');
        const t = translations[currentLang];
        handStateElement.textContent = t.reconnecting;
        connectionStatusElement.classList.remove('bg-green-500', 'bg-red-500');
        connectionStatusElement.classList.add('bg-yellow-500');
        connectionStatusElement.setAttribute('aria-label', t.reconnecting);
    });

    client.on('error', (err) => {
        console.error('MQTT connection error:', err);
        const t = translations[currentLang];
        handStateElement.textContent = t.connectionFailed;
        connectionStatusElement.classList.remove('bg-green-500', 'bg-yellow-500');
        connectionStatusElement.classList.add('bg-red-500');
        connectionStatusElement.setAttribute('aria-label', t.connectionFailed);
    });

    client.on('close', () => {
        console.log('MQTT connection closed');
        const t = translations[currentLang];
        handStateElement.textContent = t.disconnected;
        connectionStatusElement.classList.remove('bg-green-500', 'bg-yellow-500');
        connectionStatusElement.classList.add('bg-red-500');
        connectionStatusElement.setAttribute('aria-label', t.disconnected);
    });

    client.on('message', (topic, message) => {
        const payload = message.toString();
        console.log(`Received message on ${topic}: ${payload}`);
        
        const now = new Date();
        const timestamp = now.toLocaleTimeString(currentLang === 'vi' ? 'vi-VN' : 'en-US', { 
            hour: '2-digit', 
            minute: '2-digit', 
            second: '2-digit' 
        });

        try {
            if (topic === mqttTopic) {
                const angle = payload;
                let handState = '';
                let imageSrc = '';
                let chartValue = 0;

                if (angle === '0') {
                    handState = translations[currentLang].handOpen;
                    imageSrc = 'open_hand.png';
                    chartValue = 0;
                } else if (angle === '180') {
                    handState = translations[currentLang].handClose;
                    imageSrc = 'closed_hand.png';
                    chartValue = 1;
                } else {
                    console.warn('Unknown angle value:', angle);
                    return;
                }

                handStateElement.textContent = handState;
                handImageElement.src = imageSrc;
                handImageElement.alt = handState;

                handChart.data.labels.push(timestamp);
                handChart.data.datasets[0].data.push(chartValue);
                transitionCount++;
                transitionCountElement.textContent = `${translations[currentLang].transitionCount}: ${transitionCount}`;

                if (handChart.data.labels.length > 20) {
                    handChart.data.labels.shift();
                    handChart.data.datasets[0].data.shift();
                }

                handChart.update();

            } else if (topic === mqttEMATopic) {
                // Xử lý JSON {"s1_filtered": ..., "s2_filtered": ..., "firmware": "..."}
                try {
                    const obj = JSON.parse(payload);
                    
                    // ✅ CẬP NHẬT FIRMWARE VERSION TỪ MQTT
                    // Accept multiple possible field names from firmware: s1_filtered / s1 / s1_ema
                    if (obj.firmware !== undefined && obj.firmware !== null) {
                        firmwareVersion = obj.firmware;
                        firmwareVersionElement.textContent = `${translations[currentLang].firmwareVersion}: ${firmwareVersion}`;
                        console.log(`✅ Firmware version updated from MQTT: ${firmwareVersion}`);
                    }

                    // Normalize sensor keys: support `s1_filtered` or `s1` (device may publish either)
                    const s1val = (obj.s1_filtered !== undefined) ? obj.s1_filtered : (obj.s1 !== undefined ? obj.s1 : (obj.s1_ema !== undefined ? obj.s1_ema : undefined));
                    const s2val = (obj.s2_filtered !== undefined) ? obj.s2_filtered : (obj.s2 !== undefined ? obj.s2 : (obj.s2_ema !== undefined ? obj.s2_ema : undefined));

                    if (s1val !== undefined || s2val !== undefined) {
                        currentFiltered1 = s1val !== undefined && s1val !== null ? parseFloat(s1val) : null;
                        currentFiltered2 = s2val !== undefined && s2val !== null ? parseFloat(s2val) : null;
                        
                        if (currentFiltered1 !== null && currentFiltered2 !== null) {
                            safeSet(filteredLineElement, `S1_EMA: ${currentFiltered1.toFixed(2)} | S2_EMA: ${currentFiltered2.toFixed(2)}`);
                        } else if (currentFiltered1 !== null) {
                            safeSet(filteredLineElement, `S1_EMA: ${currentFiltered1.toFixed(2)} | S2_EMA: ${translations[currentLang].noData}`);
                        } else if (currentFiltered2 !== null) {
                            safeSet(filteredLineElement, `S1_EMA: ${translations[currentLang].noData} | S2_EMA: ${currentFiltered2.toFixed(2)}`);
                        }

                        filteredData.push({ 
                            timestamp: now, 
                            s1_filtered: currentFiltered1, 
                            s2_filtered: currentFiltered2 
                        });
                        if (filteredData.length > 200) filteredData.shift();

                        const timeLabel = timestamp;
                        emgChart.data.labels.push(timeLabel);
                        emgChart.data.datasets[0].data.push(currentFiltered1 !== null ? currentFiltered1 : NaN);
                        if (emgChart.data.datasets[1]) emgChart.data.datasets[1].data.push(currentFiltered2 !== null ? currentFiltered2 : NaN);
                        
                        const maxPoints = 200;
                        if (emgChart.data.labels.length > maxPoints) {
                            emgChart.data.labels.shift();
                            emgChart.data.datasets[0].data.shift();
                            emgChart.data.datasets[1].data.shift();
                        }
                        emgChart.update();
                        console.log(`Filtered data updated: s1=${currentFiltered1}, s2=${currentFiltered2}`);
                        return;
                    }
                } catch (e) {
                    console.warn('Failed to parse as JSON:', payload);
                }

                // Fallback: numeric payload
                const singleValue = parseFloat(payload);
                if (!isNaN(singleValue)) {
                    currentFiltered1 = singleValue;
                    safeSet(filteredLineElement, `S1_EMA: ${singleValue.toFixed(2)} | S2_EMA: ${translations[currentLang].noData}`);
                    
                    filteredData.push({ 
                        timestamp: now, 
                        s1_filtered: singleValue, 
                        s2_filtered: null 
                    });
                    if (filteredData.length > 200) filteredData.shift();
                    
                    const timeLabel = timestamp;
                    emgChart.data.labels.push(timeLabel);
                    emgChart.data.datasets[0].data.push(singleValue);
                    if (emgChart.data.labels.length > 200) {
                        emgChart.data.labels.shift();
                        emgChart.data.datasets[0].data.shift();
                        if (emgChart.data.datasets[1]) emgChart.data.datasets[1].data.shift();
                    }
                    emgChart.update();
                    console.log(`Single value updated: ${singleValue.toFixed(2)}`);
                }

            } else if (topic === mqttTrainTopic || topic === mqttOtaTopic) {
                // ✅ CẬP NHẬT FIRMWARE VERSION TỪ OTA/TRAIN TOPICS
                try {
                    const obj = JSON.parse(payload);
                    
                    // Cập nhật firmware nếu có trong payload
                    if (obj.firmware !== undefined && obj.firmware !== null) {
                        firmwareVersion = obj.firmware;
                        firmwareVersionElement.textContent = `${translations[currentLang].firmwareVersion}: ${firmwareVersion}`;
                        console.log(`✅ Firmware version updated from ${topic}: ${firmwareVersion}`);
                    }
                    
                    // Xử lý training messages
                    if (topic === mqttTrainTopic) {
                        // training started
                        if (obj.status === 'training_started' || obj.status === 'started') {
                            trainingStatus = translations[currentLang].trainingInProgress;
                            trainingStatusElement.textContent = `${translations[currentLang].trainingStatus}: ${trainingStatus}`;
                            // show timer if duration included
                            const dur = obj.duration !== undefined ? parseInt(obj.duration) : TRAINING_DURATION;
                            trainingTimer = dur;
                            trainingTimerElement.textContent = `${translations[currentLang].trainingTimer}: ${trainingTimer}s`;
                            trainingTimerElement.classList.remove('hidden');

                        // progress update
                        } else if (obj.status === 'training_progress' || obj.status === 'progress') {
                            const progress = obj.progress !== undefined ? parseInt(obj.progress) : null;
                            const dur = obj.duration !== undefined ? parseInt(obj.duration) : TRAINING_DURATION;
                            if (progress !== null && !isNaN(progress)) {
                                trainingStatus = translations[currentLang].trainingInProgress;
                                trainingStatusElement.textContent = `${translations[currentLang].trainingStatus}: ${trainingStatus} (${progress}%)`;
                                // estimate remaining seconds
                                const remaining = Math.max(0, Math.ceil((1 - (progress / 100)) * dur));
                                trainingTimer = remaining;
                                trainingTimerElement.textContent = `${translations[currentLang].trainingTimer}: ${trainingTimer}s`;
                                trainingTimerElement.classList.remove('hidden');
                            }

                        // collection finished (device finished collecting samples)
                        } else if (obj.status === 'collection_done' || obj.status === 'training_done') {
                            if (obj.threshold_low !== undefined) {
                                thresholdLowValue = parseInt(obj.threshold_low);
                                thresholdLowElement.textContent = `${translations[currentLang].thresholdLow}: ${thresholdLowValue}`;
                            }
                            if (obj.threshold_high !== undefined) {
                                thresholdHighValue = parseInt(obj.threshold_high);
                                thresholdHighElement.textContent = `${translations[currentLang].thresholdHigh}: ${thresholdHighValue}`;
                            }
                            trainingStatus = translations[currentLang].trainingCompleted;
                            trainingStatusElement.textContent = `${translations[currentLang].trainingStatus}: ${trainingStatus}`;
                            trainingTimerElement.classList.add('hidden');
                            console.log('Training/collection completed:', obj);

                        } else if (obj.status === 'not_enough_samples' || obj.status === 'insufficient_data') {
                            document.getElementById('error-content').textContent = translations[currentLang].noData + ' (training)';
                            openErrorModal();
                        }
                    }
                } catch (err) {
                    console.warn('Non-JSON message on', topic, ':', payload);
                }
                return;
            } else if (topic === mqttThresholdLowTopic) {
                // payload may be a string number
                const vLow = parseInt(payload);
                thresholdLowValue = isNaN(vLow) ? payload : vLow;
                thresholdLowElement.textContent = `${translations[currentLang].thresholdLow}: ${thresholdLowValue}`;

            } else if (topic === mqttThresholdHighTopic) {
                const vHigh = parseInt(payload);
                thresholdHighValue = isNaN(vHigh) ? payload : vHigh;
                thresholdHighElement.textContent = `${translations[currentLang].thresholdHigh}: ${thresholdHighValue}`;
            }
        } catch (error) {
            console.error('Error processing MQTT message:', error);
        }
    });

    // Thiết lập event listeners
    function setupEventListeners() {
        document.getElementById('font-small').addEventListener('click', () => changeFontSize('small'));
        document.getElementById('font-medium').addEventListener('click', () => changeFontSize('medium'));
        document.getElementById('font-large').addEventListener('click', () => changeFontSize('large'));

        document.getElementById('lang-vi').addEventListener('click', () => setLanguage('vi'));
        document.getElementById('lang-en').addEventListener('click', () => setLanguage('en'));

        document.getElementById('zoom-in-hand').addEventListener('click', () => zoomChart('hand-chart', 1.2));
        document.getElementById('zoom-out-hand').addEventListener('click', () => zoomChart('hand-chart', 0.8));
        document.getElementById('zoom-in-emg').addEventListener('click', () => zoomChart('emg-chart', 1.2));
        document.getElementById('zoom-out-emg').addEventListener('click', () => zoomChart('emg-chart', 0.8));

        document.getElementById('export-emg').addEventListener('click', exportEMGData);
        document.getElementById('guide-button').addEventListener('click', openGuideModal);
        document.getElementById('train-button').addEventListener('click', startTraining);
        document.getElementById('reset-button').addEventListener('click', resetThresholds);
        
        document.getElementById('test-ema').addEventListener('click', () => {
            if (client && client.connected) {
                const sample = { s1_filtered: 18.5, s2_filtered: 15.2, firmware: 'v1.2.0-test' };
                client.publish(mqttEMATopic, JSON.stringify(sample));
                console.log('Published test data:', sample);
                alert('Đã gửi dữ liệu test: ' + JSON.stringify(sample));
            } else {
                console.warn('MQTT not connected');
            }
        });

        document.getElementById('close-guide').addEventListener('click', closeGuideModal);
        document.getElementById('close-error').addEventListener('click', closeErrorModal);

        document.getElementById('guide-modal').addEventListener('click', (e) => {
            if (e.target === document.getElementById('guide-modal')) {
                closeGuideModal();
            }
        });

        document.getElementById('error-modal').addEventListener('click', (e) => {
            if (e.target === document.getElementById('error-modal')) {
                closeErrorModal();
            }
        });
    }

    // Khởi tạo giao diện
    function initializeApp() {
        setLanguage('vi');
        updateEMGChart();
        
        setInterval(() => updateEMGChart(thingspeakApiUrl), 15000);
        
        setupEventListeners();
    }

    initializeApp();
});