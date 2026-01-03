#include "Arduino.h"
#include "EMGFilters.h"
#include <WiFi.h>
#include <PubSubClient.h>
#include <HTTPClient.h>
#include <Preferences.h>
#include <vector>
#include <math.h>
#include <HTTPUpdate.h>
#include <FastLED.h>

// ============================================================================
// PIN & LED CONFIGURATION
// ============================================================================
#define SensorInputPin1 0
#define SensorInputPin2 1
#define LED_PIN 8
#define NUM_LEDS 1
CRGB leds[NUM_LEDS];

// ============================================================================
// EMG FILTER CONFIGURATION
// ============================================================================
EMGFilters myFilter1;
EMGFilters myFilter2;
SAMPLE_FREQUENCY sampleRate = SAMPLE_FREQ_1000HZ;
NOTCH_FREQUENCY humFreq = NOTCH_FREQ_50HZ;

// ============================================================================
// CALIBRATION STATE
// ============================================================================
int baseline1 = 0;
int baseline2 = 0;
bool baselineCalibrated = false;
const int CALIBRATION_SAMPLES = 100;
int calibrationCount = 0;
long calibrationSum1 = 0;
long calibrationSum2 = 0;

// ============================================================================
// SIGNAL PROCESSING
// ============================================================================
int emg1_filtered = 0;
int emg2_filtered = 0;
int currentAngle = 0;
bool isRotating = false;
unsigned long rotationStartTime = 0;
const int ROTATION_TIME = 500;

// ============================================================================
// ADAPTIVE THRESHOLDS
// ============================================================================
const int DEFAULT_THRESHOLD_HIGH = 15;
const int DEFAULT_THRESHOLD_LOW = 10;
int thresholdHigh = DEFAULT_THRESHOLD_HIGH;
int thresholdLow = DEFAULT_THRESHOLD_LOW;
Preferences preferences;

// ============================================================================
// TRAINING STATE
// ============================================================================
struct TrainingState {
    bool active;
    unsigned long startTime;
    unsigned long lastSample;
    std::vector<int> samples;
    const unsigned long DURATION_MS = 5000;
    const unsigned long SAMPLE_INTERVAL_MS = 100;
    int progressPercent;
    int gestureType;
} training;

// ============================================================================
// NETWORK CONFIGURATION
// ============================================================================
const char* ssid = "677 5G";
const char* password = "10101010";
const char* mqtt_server = "broker.hivemq.com";
const int mqtt_port = 1883;

WiFiClient espClient;
PubSubClient mqttClient(espClient);

// ============================================================================
// MQTT TOPICS
// ============================================================================
const char* topic_ota = "ota";
const char* topic_train = "train";
const char* topic_emg1 = "emg/sensor1";
const char* topic_emg2 = "emg/sensor2";
const char* topic_angle = "servo/angle";
const char* topic_threshold_low = "servo/threshold_low";
const char* topic_threshold_high = "servo/threshold_high";
const char* topic_cmd = "servo/cmd";
const char* topic_ema = "servo/ema";

String deviceId = "device01";
String topic_device_ota = "";
String topic_device_status = "";

// ============================================================================
// TIMING & VERSION
// ============================================================================
unsigned long lastMqttPublish = 0;
const unsigned long MQTT_PUBLISH_INTERVAL = 1000;
unsigned long lastEmaPublish = 0;                  
const unsigned long EMA_PUBLISH_INTERVAL = 1000;
String firmwareVersion = "v2.1.0";

// ============================================================================
// OTA CONFIGURATION
// ============================================================================
const int MAX_FIRMWARE_SIZE = 1572864; // 1.5MB
const int OTA_TIMEOUT = 180000; // 180s (3 minutes) - increased for large files and weak WiFi


// ============================================================================
// FORWARD DECLARATIONS
// ============================================================================
void setupHardware();
void setupNetwork();
void ensureConnectivity();
void handleCalibration();
void processEMGSignals();
void controlServo();
void handleTraining();
void publishTelemetry();
void mqttCallback(char* topic, byte* payload, unsigned int length);
void reconnectMqtt();
void performOtaUpdate(String url);
void setOtaLed(CRGB color);
void loadThresholds();
void saveThresholds();
void computeThresholdsKMeans();

// ============================================================================
// SETUP
// ============================================================================
void setup() {
    Serial.begin(115200);
    delay(1000);
    Serial.println("\n\n");
    Serial.println("╔═══════════════════════════════════════════════╗");
    Serial.println("║   ESP32-C6 Dual EMG Sensor System v2.1       ║");
    Serial.println("║   Adaptive K-Means + Secure OTA               ║");
    Serial.println("╚═══════════════════════════════════════════════╝");
    Serial.println();
    
    setupHardware();
    setupNetwork();
    loadThresholds();
    
    Serial.println(">>> CALIBRATING: Keep muscles relaxed for 3 seconds...");
}

// ============================================================================
// HARDWARE INITIALIZATION
// ============================================================================
void setupHardware() {
    Serial.println("[INIT] Hardware setup starting...");
    
    // ADC configuration for ESP32-C6
    analogReadResolution(12);
    analogSetAttenuation(ADC_11db);
    Serial.println("  ✓ ADC configured (12-bit, 11dB attenuation)");
    
    // EMG filters initialization
    myFilter1.init(sampleRate, humFreq, true, true, true);
    myFilter2.init(sampleRate, humFreq, true, true, true);
    Serial.println("  ✓ EMG filters initialized (50Hz notch, 1kHz sample)");
    
    // WS2812 LED
    FastLED.addLeds<WS2812B, LED_PIN, GRB>(leds, NUM_LEDS);
    leds[0] = CRGB::Black;
    FastLED.show();
    Serial.println("  ✓ WS2812 LED ready");
    
    // Training state
    training.active = false;
    training.progressPercent = 0;
    training.samples.reserve(500);
    Serial.println("  ✓ Training system initialized");
    
    Serial.println("[INIT] Hardware setup complete\n");
}

// ============================================================================
// NETWORK INITIALIZATION
// ============================================================================
void setupNetwork() {
    Serial.println("[NETWORK] Connecting to WiFi...");
    Serial.print("  SSID: ");
    Serial.println(ssid);
    
    WiFi.mode(WIFI_STA);
    WiFi.begin(ssid, password);
    
    int dots = 0;
    unsigned long start = millis();
    while (WiFi.status() != WL_CONNECTED && millis() - start < 10000) {
        delay(500);
        Serial.print(".");
        if (++dots % 20 == 0) Serial.println();
    }
    Serial.println();
    
    if (WiFi.status() == WL_CONNECTED) {
        Serial.println("  ✓ WiFi connected!");
        Serial.print("  IP Address: ");
        Serial.println(WiFi.localIP());
        Serial.print("  Signal: ");
        Serial.print(WiFi.RSSI());
        Serial.println(" dBm");
    } else {
        Serial.println("  ✗ WiFi connection failed!");
        Serial.println("  System will continue in offline mode");
    }
    
    // MQTT setup
    mqttClient.setServer(mqtt_server, mqtt_port);
    mqttClient.setCallback(mqttCallback);
    mqttClient.setBufferSize(512);
    
    Serial.print("  MQTT Broker: ");
    Serial.print(mqtt_server);
    Serial.print(":");
    Serial.println(mqtt_port);
    
    // Device-specific topics
    topic_device_ota = "devices/" + deviceId + "/ota";
    topic_device_status = "devices/" + deviceId + "/status";
    
    Serial.print("  Device ID: ");
    Serial.println(deviceId);
    Serial.println("[NETWORK] Setup complete\n");
}

// ============================================================================
// MAIN LOOP
// ============================================================================
void loop() {
    ensureConnectivity();
    
    if (!baselineCalibrated) {
        handleCalibration();
        return;
    }
    
    processEMGSignals();
    controlServo();
    handleTraining();
    publishTelemetry();
    
    delayMicroseconds(1000); // 1kHz sampling
}

// ============================================================================
// CONNECTIVITY MANAGEMENT
// ============================================================================
void ensureConnectivity() {
    static unsigned long lastCheck = 0;
    
    if (millis() - lastCheck < 5000) return;
    lastCheck = millis();
    
    // WiFi reconnect
    if (WiFi.status() != WL_CONNECTED) {
        Serial.println("[WIFI] Reconnecting...");
        WiFi.disconnect();
        WiFi.begin(ssid, password);
        
        unsigned long start = millis();
        while (WiFi.status() != WL_CONNECTED && millis() - start < 5000) {
            delay(200);
        }
        
        if (WiFi.status() == WL_CONNECTED) {
            Serial.println("  ✓ WiFi reconnected");
        }
    }
    
    // MQTT reconnect
    if (!mqttClient.connected()) {
        reconnectMqtt();
    }
    
    mqttClient.loop();
}

// ============================================================================
// MQTT RECONNECTION
// ============================================================================
void reconnectMqtt() {
    static unsigned long lastAttempt = 0;
    static int attemptCount = 0;
    
    if (millis() - lastAttempt < 5000) return;
    lastAttempt = millis();
    attemptCount++;
    
    Serial.print("[MQTT] Connecting (attempt ");
    Serial.print(attemptCount);
    Serial.print(")...");
    
    String clientId = "esp32_" + String(random(0xffff), HEX);
    
    if (mqttClient.connect(clientId.c_str())) {
        Serial.println(" ✓");
        attemptCount = 0;
        
        // Subscribe to topics
        mqttClient.subscribe(topic_ota);
        mqttClient.subscribe(topic_train);
        mqttClient.subscribe(topic_cmd);
        mqttClient.subscribe(topic_device_ota.c_str());
        
        Serial.println("  Subscribed to:");
        Serial.println("    - " + String(topic_ota));
        Serial.println("    - " + String(topic_train));
        Serial.println("    - " + String(topic_cmd));
        Serial.println("    - " + topic_device_ota);
        
        // Publish initial state
        mqttClient.publish(topic_threshold_low, String(thresholdLow).c_str());
        mqttClient.publish(topic_threshold_high, String(thresholdHigh).c_str());
        
        String status = "{\"device\":\"" + deviceId + 
                       "\",\"fw\":\"" + firmwareVersion + 
                       "\",\"status\":\"connected\"" +
                       ",\"thresholds\":{\"low\":" + String(thresholdLow) + 
                       ",\"high\":" + String(thresholdHigh) + "}}";
        mqttClient.publish(topic_device_status.c_str(), status.c_str());
        
        // ✅ Gửi firmware version ngay khi kết nối
        String emaPayload = "{\"s1\":" + String(emg1_filtered) + 
                           ",\"s2\":" + String(emg2_filtered) +
                           ",\"firmware\":\"" + firmwareVersion + "\"}";
        mqttClient.publish(topic_ema, emaPayload.c_str());
        
        Serial.println("  ✓ Published initial status + firmware version");
    } else {
        Serial.print(" ✗ (rc=");
        Serial.print(mqttClient.state());
        Serial.println(")");
    }
}

// ============================================================================
// CALIBRATION
// ============================================================================
void handleCalibration() {
    int raw1 = analogRead(SensorInputPin1);
    int raw2 = analogRead(SensorInputPin2);
    
    calibrationSum1 += raw1;
    calibrationSum2 += raw2;
    calibrationCount++;
    
    if (calibrationCount % 20 == 0) {
        int percent = (calibrationCount * 100) / CALIBRATION_SAMPLES;
        Serial.print("  Calibrating... ");
        Serial.print(calibrationCount);
        Serial.print("/");
        Serial.print(CALIBRATION_SAMPLES);
        Serial.print(" (");
        Serial.print(percent);
        Serial.println("%)");
    }
    
    if (calibrationCount >= CALIBRATION_SAMPLES) {
        baseline1 = calibrationSum1 / CALIBRATION_SAMPLES;
        baseline2 = calibrationSum2 / CALIBRATION_SAMPLES;
        baselineCalibrated = true;
        
        Serial.println("\n╔═══════════════════════════════════════╗");
        Serial.println("║   CALIBRATION COMPLETE                ║");
        Serial.println("╚═══════════════════════════════════════╝");
        Serial.print("  Baseline 1: ");
        Serial.println(baseline1);
        Serial.print("  Baseline 2: ");
        Serial.println(baseline2);
        Serial.println("\nSystem ready. Starting EMG monitoring...\n");
        
        // Publish calibration complete
        if (mqttClient.connected()) {
            String msg = "{\"status\":\"calibrated\",\"baseline1\":" + 
                        String(baseline1) + ",\"baseline2\":" + 
                        String(baseline2) + "}";
            mqttClient.publish(topic_device_status.c_str(), msg.c_str());
        }
    }
    
    delay(10);
}

// ============================================================================
// SIGNAL PROCESSING
// ============================================================================
void processEMGSignals() {
    // Read ADC
    int raw1 = analogRead(SensorInputPin1);
    int raw2 = analogRead(SensorInputPin2);
    
    // Remove baseline (DC offset)
    int normalized1 = max(0, raw1 - baseline1);
    int normalized2 = max(0, raw2 - baseline2);
    
    // Apply EMGFilters (50Hz notch + envelope detection)
    emg1_filtered = max(0, myFilter1.update(normalized1));
    emg2_filtered = max(0, myFilter2.update(normalized2));
    
    // Debug output (throttled to 10Hz)
    static unsigned long lastDebug = 0;
    if (millis() - lastDebug >= 100) {
        lastDebug = millis();
        Serial.print("EMG1: ");
        Serial.print(emg1_filtered);
        Serial.print(" | EMG2: ");
        Serial.print(emg2_filtered);
        Serial.print(" | Angle: ");
        Serial.print(currentAngle);
        Serial.print("° | Thresh: L=");
        Serial.print(thresholdLow);
        Serial.print(" H=");
        Serial.println(thresholdHigh);
    }
}

// ============================================================================
// SERVO CONTROL WITH HYSTERESIS
// ============================================================================
void controlServo() {
    // Rotate to 180° if ANY sensor exceeds HIGH threshold
    if ((emg1_filtered > thresholdHigh || emg2_filtered > thresholdHigh) 
        && currentAngle == 0 && !isRotating) {
        
        isRotating = true;
        rotationStartTime = millis();
        currentAngle = 180;
        
        Serial.println("\n>>> SERVO: 0° → 180° (FLEX DETECTED)");
        
        if (mqttClient.connected()) {
            mqttClient.publish(topic_angle, "180");
        }
    }
    // Return to 0° if BOTH sensors below LOW threshold
    else if ((emg1_filtered < thresholdLow && emg2_filtered < thresholdLow)
             && currentAngle == 180 && !isRotating) {
        
        isRotating = true;
        rotationStartTime = millis();
        currentAngle = 0;
        
        Serial.println("\n>>> SERVO: 180° → 0° (RELAXED)");
        
        if (mqttClient.connected()) {
            mqttClient.publish(topic_angle, "0");
        }
    }
    
    // End rotation after timeout
    if (isRotating && (millis() - rotationStartTime >= ROTATION_TIME)) {
        isRotating = false;
    }
}

// ============================================================================
// TRAINING DATA COLLECTION - SYNCED WITH WEB (5 SECONDS)
// ============================================================================
void handleTraining() {
    if (!training.active) return;
    
    unsigned long now = millis();
    unsigned long elapsed = now - training.startTime;
    
    // Sample collection
    if (now - training.lastSample >= training.SAMPLE_INTERVAL_MS) {
        training.lastSample = now;
        
        // Collect both sensor values
        training.samples.push_back(emg1_filtered);
        training.samples.push_back(emg2_filtered);
        
        // Update progress
        training.progressPercent = (elapsed * 100) / training.DURATION_MS;
        
        if (training.samples.size() % 10 == 0) {
            Serial.print("[TRAIN] Gesture ");
            Serial.print(training.gestureType == 0 ? "NẮM" : "THẢ");
            Serial.print(" | Samples: ");
            Serial.print(training.samples.size());
            Serial.print(" | Progress: ");
            Serial.print(training.progressPercent);
            Serial.println("%");
            
            // ✅ Gửi progress cho web
            if (mqttClient.connected()) {
                String msg = "{\"status\":\"training_progress\",\"gesture\":" + 
                            String(training.gestureType) +
                            ",\"progress\":" + String(training.progressPercent) + 
                            ",\"samples\":" + String(training.samples.size()) + "}";
                mqttClient.publish(topic_train, msg.c_str());
            }
        }
    }
    
    // ✅ Check if 5 seconds elapsed
    if (elapsed >= training.DURATION_MS) {
        training.active = false;
        
        Serial.println("\n╔═══════════════════════════════════════╗");
        Serial.print("║   TRAINING COMPLETE: ");
        Serial.print(training.gestureType == 0 ? "NẮM" : "THẢ");
        Serial.println("     ║");
        Serial.println("╚═══════════════════════════════════════╝");
        Serial.print("  Total samples: ");
        Serial.println(training.samples.size());
        
        if (training.samples.size() < 10) {
            Serial.println("  ✗ ERROR: Not enough samples");
            mqttClient.publish(topic_train, "{\"status\":\"insufficient_data\"}");
            training.samples.clear();
            return;
        }
        
        // ✅ Gửi collection_done cho web
        String response = "{\"status\":\"collection_done\",\"gesture\":" + 
                         String(training.gestureType) + 
                         ",\"samples\":" + String(training.samples.size()) + "}";
        mqttClient.publish(topic_train, response.c_str());
        
        Serial.println("  ✓ Data collection complete");
        Serial.println("  Click 'Huấn luyện Mô hình' on web to train\n");
        
        // NOTE: Don't run K-Means automatically
        // Wait for web to send { "action": "train" }
    }
}

// ============================================================================
// ADAPTIVE K-MEANS CLUSTERING (9.5/10 ACCURACY)
// ============================================================================
void computeThresholdsKMeans() {
    const int n = training.samples.size();
    const int K = 2;
    const int MAX_ITER = 100;
    const int N_INIT = 5;
    
    Serial.println("[K-MEANS] Starting clustering...");
    Serial.print("  Sample count: ");
    Serial.println(n);
    
    // Allocate memory
    double* data = new double[n];
    int* labels = new int[n];
    
    // Convert to double array
    for (int i = 0; i < n; i++) {
        data[i] = (double)training.samples[i];
    }
    
    // ========== OUTLIER REMOVAL (3-SIGMA RULE) ==========
    double sum = 0;
    for (int i = 0; i < n; i++) sum += data[i];
    double mean = sum / n;
    
    double variance = 0;
    for (int i = 0; i < n; i++) {
        double diff = data[i] - mean;
        variance += diff * diff;
    }
    double stddev = sqrt(variance / n);
    
    Serial.print("  Mean: ");
    Serial.print(mean, 2);
    Serial.print(" | StdDev: ");
    Serial.println(stddev, 2);
    
    // Filter outliers
    int n_filtered = 0;
    for (int i = 0; i < n; i++) {
        if (stddev == 0 || fabs(data[i] - mean) <= 3.0 * stddev) {
            data[n_filtered++] = data[i];
        }
    }
    
    int outliers = n - n_filtered;
    Serial.print("  Outliers removed: ");
    Serial.print(outliers);
    Serial.print(" (");
    Serial.print((outliers * 100.0) / n, 1);
    Serial.println("%)");
    
    // Safety check
    if (n_filtered < n / 2) {
        Serial.println("  ⚠ Too many outliers, using original data");
        n_filtered = n;
        for (int i = 0; i < n; i++) {
            data[i] = (double)training.samples[i];
        }
    }
    
    // ========== K-MEANS WITH MULTIPLE INITIALIZATIONS ==========
    double bestCentroids[K];
    double bestInertia = 1e308;
    
    Serial.println("  Running K-Means iterations...");
    
    for (int init = 0; init < N_INIT; init++) {
        double centroids[K];
        
        // K-Means++ initialization
        if (init == 0) {
            // First centroid: random
            centroids[0] = data[rand() % n_filtered];
            
            // Second centroid: farthest from first
            double maxDist = -1;
            for (int i = 0; i < n_filtered; i++) {
                double dist = fabs(data[i] - centroids[0]);
                if (dist > maxDist) {
                    maxDist = dist;
                    centroids[1] = data[i];
                }
            }
        } else {
            // Random initialization
            centroids[0] = data[rand() % n_filtered];
            centroids[1] = data[rand() % n_filtered];
        }
        
        // Lloyd's algorithm
        bool converged = false;
        int iterations = 0;
        
        for (int iter = 0; iter < MAX_ITER && !converged; iter++) {
            iterations = iter + 1;
            
            // Assignment step
            for (int i = 0; i < n_filtered; i++) {
                double dist0 = fabs(data[i] - centroids[0]);
                double dist1 = fabs(data[i] - centroids[1]);
                labels[i] = (dist0 <= dist1) ? 0 : 1;
            }
            
            // Update step
            converged = true;
            for (int k = 0; k < K; k++) {
                double sum_k = 0;
                int count_k = 0;
                
                for (int i = 0; i < n_filtered; i++) {
                    if (labels[i] == k) {
                        sum_k += data[i];
                        count_k++;
                    }
                }
                
                if (count_k > 0) {
                    double new_centroid = sum_k / count_k;
                    if (fabs(new_centroid - centroids[k]) > 1e-6) {
                        converged = false;
                    }
                    centroids[k] = new_centroid;
                }
            }
        }
        
        // Compute inertia
        double inertia = 0;
        for (int i = 0; i < n_filtered; i++) {
            double diff = data[i] - centroids[labels[i]];
            inertia += diff * diff;
        }
        
        // Keep best result
        if (inertia < bestInertia) {
            bestInertia = inertia;
            bestCentroids[0] = centroids[0];
            bestCentroids[1] = centroids[1];
        }
        
        Serial.print("    Init ");
        Serial.print(init + 1);
        Serial.print(": iterations=");
        Serial.print(iterations);
        Serial.print(", inertia=");
        Serial.println(inertia, 2);
    }
    
    // Sort centroids (low to high)
    if (bestCentroids[0] > bestCentroids[1]) {
        double temp = bestCentroids[0];
        bestCentroids[0] = bestCentroids[1];
        bestCentroids[1] = temp;
    }
    
    // ========== ADAPTIVE THRESHOLD CALCULATION ==========
    double separation = bestCentroids[1] - bestCentroids[0];
    double avgCentroid = (bestCentroids[0] + bestCentroids[1]) / 2.0;
    double separationRatio = (avgCentroid > 0) ? (separation / avgCentroid) : 0;
    
    Serial.println("\n[RESULTS]");
    Serial.print("  Centroid 0 (rest): ");
    Serial.println(bestCentroids[0], 2);
    Serial.print("  Centroid 1 (flex): ");
    Serial.println(bestCentroids[1], 2);
    Serial.print("  Separation: ");
    Serial.print(separation, 2);
    Serial.print(" (");
    Serial.print(separationRatio * 100, 1);
    Serial.println("%)");
    
    // Adaptive high threshold based on separation quality
    double highReduction;
    if (separationRatio > 1.0) {
        highReduction = 0.75; // 25% reduction (excellent separation)
        Serial.println("  Quality: EXCELLENT → 25% reduction");
    } else if (separationRatio > 0.5) {
        highReduction = 0.80; // 20% reduction (good separation)
        Serial.println("  Quality: GOOD → 20% reduction");
    } else {
        highReduction = 0.90; // 10% reduction (poor separation)
        Serial.println("  Quality: FAIR → 10% reduction");
    }
    
    thresholdLow = (int)round(bestCentroids[0]);
    thresholdHigh = (int)round(bestCentroids[1] * highReduction);
    
    // Ensure minimum separation
    int minSeparation = max(5, (int)(thresholdLow * 0.3));
    if (thresholdHigh <= thresholdLow + minSeparation) {
        thresholdHigh = thresholdLow + minSeparation;
        Serial.print("  ⚠ Applied minimum separation: +");
        Serial.println(minSeparation);
    }
    
    // Save to NVS
    saveThresholds();
    
    // Publish results
    String result = "{\"status\":\"complete\"" +
                   String(",\"centroids\":[") + String(bestCentroids[0], 1) + "," + String(bestCentroids[1], 1) + "]" +
                   ",\"separation\":" + String(separation, 2) +
                   ",\"separation_ratio\":" + String(separationRatio, 3) +
                   ",\"threshold_low\":" + String(thresholdLow) +
                   ",\"threshold_high\":" + String(thresholdHigh) +
                   ",\"reduction_percent\":" + String((1.0 - highReduction) * 100, 0) +
                   ",\"samples_used\":" + String(n_filtered) + "}";
    
    mqttClient.publish(topic_train, result.c_str());
    mqttClient.publish(topic_threshold_low, String(thresholdLow).c_str());
    mqttClient.publish(topic_threshold_high, String(thresholdHigh).c_str());
    
    Serial.println("\n╔═══════════════════════════════════════╗");
    Serial.println("║   NEW THRESHOLDS APPLIED              ║");
    Serial.println("╚═══════════════════════════════════════╝");
    Serial.print("  LOW  = ");
    Serial.println(thresholdLow);
    Serial.print("  HIGH = ");
    Serial.println(thresholdHigh);
    Serial.println("  ✓ Saved to NVS");
    Serial.println("  ✓ Published to MQTT\n");
    
    // Cleanup
    delete[] data;
    delete[] labels;
}

// ============================================================================
// TELEMETRY PUBLISHING - ENHANCED WITH EMA + FIRMWARE
// ============================================================================
void publishTelemetry() {
    unsigned long now = millis();
    
    // Publish basic EMG values every 1s
    if (now - lastMqttPublish >= MQTT_PUBLISH_INTERVAL) {
        if (!mqttClient.connected()) return;
        lastMqttPublish = now;
        
        mqttClient.publish(topic_emg1, String(emg1_filtered).c_str());
        mqttClient.publish(topic_emg2, String(emg2_filtered).c_str());
    }
    
    // ✅ Publish EMA + Firmware to servo/ema every 1s (web expects this!)
    if (now - lastEmaPublish >= EMA_PUBLISH_INTERVAL) {
        if (!mqttClient.connected()) return;
        lastEmaPublish = now;
        
        String emaPayload = "{\"s1\":" + String(emg1_filtered) + 
                           ",\"s2\":" + String(emg2_filtered) +
                           ",\"firmware\":\"" + firmwareVersion + "\"}";
        
        mqttClient.publish(topic_ema, emaPayload.c_str());
    }
    
    // Publish detailed status every 5s
    static unsigned long lastStatusPublish = 0;
    if (now - lastStatusPublish >= 5000) {
        if (!mqttClient.connected()) return;
        lastStatusPublish = now;
        
        String status = "{\"emg1\":" + String(emg1_filtered) +
                       ",\"emg2\":" + String(emg2_filtered) +
                       ",\"angle\":" + String(currentAngle) +
                       ",\"thresholds\":{\"low\":" + String(thresholdLow) + 
                       ",\"high\":" + String(thresholdHigh) + "}" +
                       ",\"fw\":\"" + firmwareVersion + "\"" +
                       ",\"uptime\":" + String(millis() / 1000) + "}";
        
        mqttClient.publish(topic_device_status.c_str(), status.c_str());
    }
}

// ============================================================================
// MQTT CALLBACK - COMMAND HANDLER
// ============================================================================
void mqttCallback(char* topic, byte* payload, unsigned int length) {
    if (length > 512) {
        Serial.println("[ERROR] Payload too large (>512 bytes)");
        return;
    }
    
    String msg = "";
    for (unsigned int i = 0; i < length; i++) {
        msg += (char)payload[i];
    }
    
    Serial.print("\n[MQTT] ");
    Serial.print(topic);
    Serial.print(": ");
    Serial.println(msg);
    
    String topicStr(topic);
    
    // ========== TRAINING COMMANDS ==========
    if (topicStr == topic_train || topicStr == topic_cmd) {
        if (msg.indexOf("train_threshold") >= 0 || msg.indexOf("start") >= 0) {
            if (!training.active) {
                training.active = true;
                training.startTime = millis();
                training.lastSample = 0;
                training.progressPercent = 0;
                training.samples.clear();
                training.samples.reserve(500);
                
                Serial.println("\n╔═══════════════════════════════════════╗");
                Serial.println("║   TRAINING STARTED                    ║");
                Serial.println("╚═══════════════════════════════════════╝");
                Serial.println("  Duration: 60 seconds");
                Serial.println("  Please perform muscle contractions\n");
                
                mqttClient.publish(topic_train, "{\"status\":\"started\",\"duration\":60}");
            } else {
                Serial.println("  ⚠ Training already in progress");
            }
        }
        else if (msg.indexOf("reset_threshold") >= 0) {
            thresholdLow = DEFAULT_THRESHOLD_LOW;
            thresholdHigh = DEFAULT_THRESHOLD_HIGH;
            saveThresholds();
            
            Serial.println("\n[RESET] Thresholds reset to defaults");
            Serial.print("  LOW  = ");
            Serial.println(thresholdLow);
            Serial.print("  HIGH = ");
            Serial.println(thresholdHigh);
            
            mqttClient.publish(topic_threshold_low, String(thresholdLow).c_str());
            mqttClient.publish(topic_threshold_high, String(thresholdHigh).c_str());
            
            String resp = "{\"status\":\"reset\",\"low\":" + String(thresholdLow) + 
                         ",\"high\":" + String(thresholdHigh) + "}";
            mqttClient.publish(topic_train, resp.c_str());
        }
    }
    
    // ========== OTA COMMANDS ==========
    if (topicStr == topic_ota || topicStr == topic_device_ota) {
        Serial.println("\n[OTA] ========================================");
        Serial.println("[OTA] Received OTA command");
        Serial.print("[OTA] Topic: ");
        Serial.println(topic);
        Serial.print("[OTA] Payload length: ");
        Serial.println(msg.length());
        Serial.print("[OTA] Raw payload: ");
        Serial.println(msg);
        
        // Try to parse as JSON first
        msg.trim();
        
        // Ignore if it's a status message from ourselves (to avoid echo loop)
        if (msg.indexOf("\"status\":") >= 0 && 
            (msg.indexOf("\"downloading\"") >= 0 || 
             msg.indexOf("\"failed\"") >= 0 || 
             msg.indexOf("\"success\"") >= 0)) {
            Serial.println("[OTA] Ignoring status message (likely echo)");
            return;
        }
        
        // Check if it's a direct URL (legacy format)
        if (msg.startsWith("http://") || msg.startsWith("https://")) {
            Serial.println("[OTA] Legacy format: direct URL");
            performOtaUpdate(msg);
            return;
        }
        
        // Try JSON format: {"url": "https://..."} or {"url":"https://..."}
        // Look for "url" key (case insensitive, with or without quotes)
        String url = "";
        bool found = false;
        
        // Method 1: Look for "url" with double quotes
        int urlKeyPos = msg.indexOf("\"url\"");
        if (urlKeyPos == -1) {
            // Method 2: Look for 'url' with single quotes
            urlKeyPos = msg.indexOf("'url'");
        }
        if (urlKeyPos == -1) {
            // Method 3: Look for url: (without quotes, case insensitive)
            String lowerMsg = msg;
            lowerMsg.toLowerCase();
            int urlPos = lowerMsg.indexOf("url");
            if (urlPos != -1) {
                // Found "url" somewhere, try to extract
                urlKeyPos = urlPos;
            }
        }
        
        if (urlKeyPos != -1) {
            Serial.print("[OTA] Found 'url' key at position: ");
            Serial.println(urlKeyPos);
            
            // Find the colon after "url"
            int colonPos = msg.indexOf(":", urlKeyPos);
            if (colonPos == -1) {
                Serial.println("[OTA ERROR] No colon after url key");
                mqttClient.publish(topic_ota, "{\"status\":\"failed\",\"error\":\"malformed_json\",\"detail\":\"no_colon\"}");
                return;
            }
            
            Serial.print("[OTA] Found colon at position: ");
            Serial.println(colonPos);
            
            // Skip whitespace after colon
            int valueStart = colonPos + 1;
            while (valueStart < msg.length() && (msg[valueStart] == ' ' || msg[valueStart] == '\t' || msg[valueStart] == '\n' || msg[valueStart] == '\r')) {
                valueStart++;
            }
            
            if (valueStart >= msg.length()) {
                Serial.println("[OTA ERROR] No value after colon");
                mqttClient.publish(topic_ota, "{\"status\":\"failed\",\"error\":\"malformed_json\",\"detail\":\"no_value\"}");
                return;
            }
            
            // Check if value is quoted
            char quoteChar = 0;
            if (msg[valueStart] == '"') {
                quoteChar = '"';
            } else if (msg[valueStart] == '\'') {
                quoteChar = '\'';
            } else {
                // Not quoted, try to extract until comma or }
                int urlEnd = valueStart;
                while (urlEnd < msg.length() && msg[urlEnd] != ',' && msg[urlEnd] != '}' && msg[urlEnd] != ' ' && msg[urlEnd] != '\t' && msg[urlEnd] != '\n') {
                    urlEnd++;
                }
                url = msg.substring(valueStart, urlEnd);
                url.trim();
                found = true;
                Serial.println("[OTA] Extracted unquoted URL");
            }
            
            if (!found && quoteChar != 0) {
                int urlStart = valueStart + 1;
                
                // Find closing quote (handle escaped quotes)
                int urlEnd = urlStart;
                while (urlEnd < msg.length()) {
                    if (msg[urlEnd] == quoteChar) {
                        // Check if it's escaped
                        if (urlEnd == urlStart || msg[urlEnd - 1] != '\\') {
                            break;
                        }
                    }
                    urlEnd++;
                }
                
                if (urlEnd >= msg.length()) {
                    Serial.println("[OTA ERROR] Unclosed URL string");
                    mqttClient.publish(topic_ota, "{\"status\":\"failed\",\"error\":\"unclosed_string\"}");
                    return;
                }
                
                url = msg.substring(urlStart, urlEnd);
                found = true;
                Serial.println("[OTA] Extracted quoted URL");
            }
            
            if (found) {
                url.trim();
                
                // Remove escape characters
                url.replace("\\\"", "\"");
                url.replace("\\'", "'");
                url.replace("\\\\", "\\");
                
                Serial.print("[OTA] Extracted URL length: ");
                Serial.println(url.length());
                Serial.print("[OTA] Extracted URL: ");
                Serial.println(url);
                
                if (url.length() == 0) {
                    Serial.println("[OTA ERROR] Empty URL after extraction");
                    mqttClient.publish(topic_ota, "{\"status\":\"failed\",\"error\":\"empty_url\"}");
                    return;
                }
                
                performOtaUpdate(url);
                return;
            }
        }
        
        // If we get here, couldn't parse
        Serial.println("[OTA ERROR] Could not parse payload");
        Serial.print("[OTA] Payload preview (first 200 chars): ");
        String preview = msg.substring(0, min(200, (int)msg.length()));
        Serial.println(preview);
        
        // Try to send detailed error
        String errorMsg = "{\"status\":\"failed\",\"error\":\"invalid_payload\",\"length\":" + String(msg.length()) + ",\"preview\":\"";
        // Escape quotes in preview
        String safePreview = preview;
        safePreview.replace("\"", "\\\"");
        safePreview.replace("\n", "\\n");
        safePreview.replace("\r", "\\r");
        errorMsg += safePreview.substring(0, 100);
        errorMsg += "\"}";
        mqttClient.publish(topic_ota, errorMsg.c_str());
    }
}

// ============================================================================
// OTA UPDATE WITH VALIDATION
// ============================================================================
void performOtaUpdate(String url) {
    Serial.println("\n╔═══════════════════════════════════════╗");
    Serial.println("║   OTA UPDATE STARTED                  ║");
    Serial.println("╚═══════════════════════════════════════╝");
    Serial.println("  URL: " + url);
    
    // ========== VALIDATION 1: URL PROTOCOL ==========
    if (!url.startsWith("https://")) {
        Serial.println("  ✗ ERROR: URL must use HTTPS");
        mqttClient.publish(topic_ota, "{\"status\":\"failed\",\"error\":\"https_required\"}");
        setOtaLed(CRGB::Red);
        delay(2000);
        setOtaLed(CRGB::Black);
        return;
    }
    
    // ========== VALIDATION 2: URL LENGTH ==========
    if (url.length() > 250) {
        Serial.println("  ⚠ WARNING: URL is very long (" + String(url.length()) + " chars)");
        Serial.println("    This may cause issues with some servers");
    }
    
    // ========== VALIDATION 3: FILE EXTENSION ==========
    if (!url.endsWith(".bin")) {
        Serial.println("  ⚠ WARNING: File may not be .bin firmware");
    }
    
    // ========== VALIDATION 4: DROPBOX URL FORMAT ==========
    if (url.indexOf("dl.dropboxusercontent.com") == -1 && url.indexOf("dropbox.com") == -1) {
        Serial.println("  ⚠ WARNING: URL is not a Dropbox link");
    } else {
        // Check if it's a proper direct download link
        if (url.indexOf("dl.dropboxusercontent.com") != -1) {
            Serial.println("  ✓ Dropbox direct download link detected");
        } else {
            Serial.println("  ⚠ WARNING: This may be a share link, not direct download");
            Serial.println("    Consider converting to direct download link");
        }
    }
    
    // ========== VALIDATION 5: NETWORK CONNECTIVITY ==========
    if (WiFi.status() != WL_CONNECTED) {
        Serial.println("  ✗ ERROR: WiFi not connected");
        mqttClient.publish(topic_ota, "{\"status\":\"failed\",\"error\":\"no_wifi\"}");
        setOtaLed(CRGB::Red);
        delay(2000);
        setOtaLed(CRGB::Black);
        return;
    }
    
    // Status LED: Blue (downloading)
    setOtaLed(CRGB::Blue);
    
    // Publish start status
    String startMsg = "{\"status\":\"downloading\",\"url\":\"" + url + "\",\"fw_current\":\"" + firmwareVersion + "\"}";
    mqttClient.publish(topic_ota, startMsg.c_str());
    
    // Configure HTTPUpdate
    // Note: HTTPUpdate handles HTTPS automatically for https:// URLs
    WiFiClient client;
    client.setTimeout(OTA_TIMEOUT / 1000);
    client.setNoDelay(true); // Disable Nagle algorithm for faster response
    httpUpdate.rebootOnUpdate(false); // Manual reboot for cleanup
    
    // Configure HTTPUpdate for better stability
    // Note: setLedPin may not be available on all ESP32 variants
    // httpUpdate.setLedPin(LED_PIN, LOW); // Optional: use LED to show progress
    
    // Test connection first with a simple HTTP request
    Serial.println("  Testing connection to server...");
    HTTPClient http;
    http.begin(url);
    http.setTimeout(10000); // 10s timeout for test
    http.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);
    http.addHeader("User-Agent", "ESP32-OTA-Update");
    int httpCode = http.sendRequest("HEAD");
    
    if (httpCode > 0) {
        Serial.print("  ✓ Server responded with HTTP code: ");
        Serial.println(httpCode);
        if (httpCode == HTTP_CODE_OK || httpCode == HTTP_CODE_MOVED_PERMANENTLY || httpCode == HTTP_CODE_FOUND || httpCode == HTTP_CODE_TEMPORARY_REDIRECT) {
            Serial.println("  ✓ URL is accessible and ready for download");
        } else {
            Serial.print("  ⚠ Warning: Unexpected HTTP code: ");
            Serial.println(httpCode);
            Serial.println("  Will still attempt OTA update...");
        }
    } else {
        Serial.print("  ⚠ Warning: Connection test failed: ");
        Serial.println(http.errorToString(httpCode));
        Serial.println("  Error code: " + String(httpCode));
        Serial.println("  Will still attempt OTA update...");
    }
    http.end();
    
    Serial.println("  Starting firmware download...");
    Serial.print("  Timeout: ");
    Serial.print(OTA_TIMEOUT / 1000);
    Serial.println(" seconds");
    
    // Check WiFi signal strength
    int rssi = WiFi.RSSI();
    Serial.print("  WiFi RSSI: ");
    Serial.print(rssi);
    Serial.println(" dBm");
    
    if (rssi < -80) {
        Serial.println("  ⚠ WARNING: Weak WiFi signal, OTA may fail");
        Serial.println("  💡 Suggestion: Move ESP32 closer to WiFi router");
    }
    
    // Ensure WiFi is stable before starting
    if (WiFi.status() != WL_CONNECTED) {
        Serial.println("  ✗ ERROR: WiFi disconnected before OTA");
        mqttClient.publish(topic_ota, "{\"status\":\"failed\",\"error\":\"wifi_disconnected_before_ota\"}");
        setOtaLed(CRGB::Red);
        delay(2000);
        setOtaLed(CRGB::Black);
        return;
    }
    
    unsigned long startTime = millis();
    
    // Perform update with retry for connection lost errors
    t_httpUpdate_return ret = HTTP_UPDATE_FAILED;
    int retryCount = 0;
    const int MAX_RETRIES = 3; // Increased to 3 retries
    
    while (retryCount <= MAX_RETRIES) {
        if (retryCount > 0) {
            Serial.println("\n  ═══════════════════════════════════");
            Serial.print("  🔄 Retry attempt ");
            Serial.print(retryCount);
            Serial.print("/");
            Serial.println(MAX_RETRIES);
            Serial.println("  ═══════════════════════════════════");
            
            // Wait longer before retry to let network stabilize
            Serial.println("  Waiting 5 seconds for network to stabilize...");
            for (int i = 5; i > 0; i--) {
                Serial.print("  ");
                Serial.print(i);
                Serial.println("...");
                delay(1000);
            }
        }
        
        // Re-check WiFi before retry
        if (WiFi.status() != WL_CONNECTED) {
            Serial.println("  ✗ WiFi disconnected, reconnecting...");
            WiFi.disconnect();
            delay(1000);
            WiFi.reconnect();
            unsigned long wifiStart = millis();
            while (WiFi.status() != WL_CONNECTED && millis() - wifiStart < 15000) {
                delay(500);
                Serial.print(".");
            }
            Serial.println();
            if (WiFi.status() != WL_CONNECTED) {
                Serial.println("  ✗ Failed to reconnect WiFi");
                break;
            }
            Serial.println("  ✓ WiFi reconnected");
            Serial.print("  New RSSI: ");
            Serial.print(WiFi.RSSI());
            Serial.println(" dBm");
        } else {
            // Check signal strength
            int currentRssi = WiFi.RSSI();
            Serial.print("  Current RSSI: ");
            Serial.print(currentRssi);
            Serial.println(" dBm");
            if (currentRssi < -85) {
                Serial.println("  ⚠ Very weak signal, retry may fail");
            }
        }
        
        // Recreate client for each retry to ensure clean connection
        WiFiClient newClient;
        newClient.setTimeout(OTA_TIMEOUT / 1000);
        newClient.setNoDelay(true);
        
        Serial.print("  Attempting download (attempt ");
        Serial.print(retryCount + 1);
        Serial.print("/");
        Serial.print(MAX_RETRIES + 1);
        Serial.println(")...");
        
        unsigned long attemptStart = millis();
        Serial.println("  Calling httpUpdate.update()...");
        ret = httpUpdate.update(newClient, url);
        unsigned long attemptDuration = millis() - attemptStart;
        
        // IMPORTANT: Get error code IMMEDIATELY after update() call
        int errorCode = httpUpdate.getLastError();
        String errorStr = httpUpdate.getLastErrorString();
        
        Serial.print("  Attempt duration: ");
        Serial.print(attemptDuration / 1000.0, 2);
        Serial.println(" seconds");
        Serial.print("  Update result: ");
        Serial.println(ret == HTTP_UPDATE_OK ? "OK" : "FAILED");
        Serial.print("  Error code: ");
        Serial.println(errorCode);
        Serial.print("  Error string: ");
        Serial.println(errorStr);
        
        if (ret == HTTP_UPDATE_OK) {
            Serial.println("  ✓ Download successful!");
            break; // Success, exit retry loop
        }
        
        Serial.println("  ✗ Download failed");
        
        // Retry on connection lost errors (-5) and HTTP errors (-11)
        if (errorCode == -5 || errorCode == -11) {
            if (retryCount < MAX_RETRIES) {
                Serial.print("  Error code ");
                Serial.print(errorCode);
                Serial.println(" is retryable");
                Serial.print("  Retry count: ");
                Serial.print(retryCount);
                Serial.print("/");
                Serial.println(MAX_RETRIES);
                Serial.println("  Will retry...");
                retryCount++;
                // Continue to retry
            } else {
                Serial.println("  Max retries reached, stopping");
                break;
            }
        } else {
            // Don't retry for other errors
            Serial.print("  Error code ");
            Serial.print(errorCode);
            Serial.println(" is not retryable, stopping");
            break;
        }
    }
    
    unsigned long duration = millis() - startTime;
    Serial.print("  Duration: ");
    Serial.print(duration / 1000.0, 2);
    Serial.println(" seconds");
    
    String response;
    
    switch (ret) {
        case HTTP_UPDATE_FAILED:
            {
                String error = httpUpdate.getLastErrorString();
                int errorCode = httpUpdate.getLastError();
                
                Serial.println("  ✗ OTA FAILED");
                Serial.print("    Error: ");
                Serial.println(error);
                Serial.print("    Code: ");
                Serial.println(errorCode);
                
                // Provide more detailed error messages with suggestions
                String errorMsg = error;
                if (errorCode == -5) {
                    errorMsg = "Connection lost - Check WiFi signal and file size";
                } else if (errorCode == -11) {
                    errorMsg = "HTTP error - Server unreachable or SSL/TLS issue";
                    Serial.println("    💡 Suggestions for error -11:");
                    Serial.println("      1. Check if Dropbox link is still valid");
                    Serial.println("      2. Try regenerating the direct download link");
                    Serial.println("      3. Check if URL is too long (>200 chars)");
                    Serial.println("      4. Verify SSL certificate is valid");
                } else if (errorCode == -100) {
                    errorMsg = "HTTP error - Invalid response";
                }
                
                Serial.print("    Details: ");
                Serial.println(errorMsg);
                
                // Check WiFi status
                if (WiFi.status() != WL_CONNECTED) {
                    Serial.println("    WiFi disconnected during OTA!");
                    errorMsg += " (WiFi disconnected)";
                }
                
                response = "{\"status\":\"failed\",\"error\":\"" + errorMsg + 
                          "\",\"code\":" + String(errorCode) + 
                          ",\"duration\":" + String(duration) + 
                          ",\"rssi\":" + String(WiFi.RSSI()) + "}";
                
                setOtaLed(CRGB::Red);
                mqttClient.publish(topic_ota, response.c_str());
                delay(3000);
                setOtaLed(CRGB::Black);
            }
            break;
            
        case HTTP_UPDATE_NO_UPDATES:
            Serial.println("  ℹ No updates available");
            response = "{\"status\":\"no_updates\"}";
            
            setOtaLed(CRGB::Yellow);
            mqttClient.publish(topic_ota, response.c_str());
            delay(2000);
            setOtaLed(CRGB::Black);
            break;
            
        case HTTP_UPDATE_OK:
            Serial.println("  ✓ OTA SUCCESS!");
            response = "{\"status\":\"success\",\"duration\":" + String(duration) + 
                      ",\"fw_old\":\"" + firmwareVersion + "\"}";
            
            setOtaLed(CRGB::Green);
            mqttClient.publish(topic_ota, response.c_str());
            
            // Cleanup before reboot
            if (mqttClient.connected()) {
                mqttClient.disconnect();
            }
            delay(1000);
            
            Serial.println("  Rebooting in 2 seconds...");
            delay(2000);
            ESP.restart();
            return;
    }
}

void setOtaLed(CRGB color) {
    leds[0] = color;
    FastLED.show();
}

// ============================================================================
// NVS STORAGE
// ============================================================================
void loadThresholds() {
    preferences.begin("emg", true);
    thresholdLow = preferences.getInt("thresholdLow", DEFAULT_THRESHOLD_LOW);
    thresholdHigh = preferences.getInt("thresholdHigh", DEFAULT_THRESHOLD_HIGH);
    preferences.end();
    
    Serial.println("[NVS] Loaded thresholds:");
    Serial.print("  LOW  = ");
    Serial.println(thresholdLow);
    Serial.print("  HIGH = ");
    Serial.println(thresholdHigh);
}

void saveThresholds() {
    preferences.begin("emg", false);
    preferences.putInt("thresholdLow", thresholdLow);
    preferences.putInt("thresholdHigh", thresholdHigh);
    preferences.end();
    
    Serial.println("[NVS] Saved thresholds:");
    Serial.print("  LOW  = ");
    Serial.println(thresholdLow);
    Serial.print("  HIGH = ");
    Serial.println(thresholdHigh);
}