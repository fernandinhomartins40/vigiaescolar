package br.com.vigiaescolar.configurador;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothGatt;
import android.bluetooth.BluetoothGattCallback;
import android.bluetooth.BluetoothGattCharacteristic;
import android.bluetooth.BluetoothGattDescriptor;
import android.bluetooth.BluetoothGattService;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothProfile;
import android.bluetooth.le.BluetoothLeScanner;
import android.bluetooth.le.ScanCallback;
import android.bluetooth.le.ScanResult;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.InetSocketAddress;
import java.net.NetworkInterface;
import java.net.Socket;
import java.net.URL;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import javax.crypto.Cipher;
import javax.crypto.spec.IvParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Random;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * VigiaEscolar — Configurador de Câmera XM/iCSee
 *
 * Protocolo BLE XM (engenharia reversa do APK iCSee v7.1.1):
 *
 *  Service UUID:    00001910-0000-1000-8000-00805f9b34fb
 *  Write Char:      00002b10-0000-1000-8000-00805f9b34fb  (app → câmera)
 *  Notify Char:     00002b11-0000-1000-8000-00805f9b34fb  (câmera → app)
 *  CCCD Descriptor: 00002902-0000-1000-8000-00805f9b34fb
 *
 *  Frame BLE: [HEAD:1B 0xAB] [FUN_ID:1B] [LEN:2B LE] [CHECKSUM:1B] [DATA:N bytes]
 *  FUN_ID:  0x01=AUTH_REQ, 0x02=AUTH_RSP, 0x03=WIFI_CFG, 0x04=WIFI_RSP, 0x05=DEV_INFO
 *
 *  Auth token: MD5(devSN + password + randomHex4)[0..15] uppercase
 *
 *  Fluxo:
 *   1. BLE scan → filtra service 0x1910 → exibe câmeras encontradas
 *   2. Conectar → discover services → enable notify 0x2b11
 *   3. Escrever AUTH frame em 0x2b10 com token MD5
 *   4. Aguardar AUTH_RSP em 0x2b11
 *   5. Escrever WIFI_CFG frame com JSON {SSID, Keys, NetType, EncrypType, Auth}
 *   6. Aguardar WIFI_RSP → sucesso → fechar GATT
 *   7. Após câmera conectar ao Wi-Fi da escola, cadastrar na API VigiaEscolar
 *
 *  Fallback AP (se BLE não disponível ou câmera não responder):
 *   - Conectar no hotspot da câmera (192.168.10.1)
 *   - Login DVRIP TCP 34567 + SetConfig NetWork.Wifi
 */
public class MainActivity extends Activity {

    // ─── UUIDs BLE XM ─────────────────────────────────────────────────────────
    private static final UUID UUID_SERVICE  = UUID.fromString("00001910-0000-1000-8000-00805f9b34fb");
    private static final UUID UUID_WRITE    = UUID.fromString("00002b10-0000-1000-8000-00805f9b34fb");
    private static final UUID UUID_NOTIFY   = UUID.fromString("00002b11-0000-1000-8000-00805f9b34fb");
    private static final UUID UUID_CCCD     = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb");

    // ─── FunID BLE ────────────────────────────────────────────────────────────
    private static final byte FUN_AUTH_REQ  = 0x01;
    private static final byte FUN_AUTH_RSP  = 0x02;
    private static final byte FUN_WIFI_CFG  = 0x03;
    private static final byte FUN_WIFI_RSP  = 0x04;
    private static final byte FUN_DEV_INFO  = 0x05;
    private static final byte BLE_HEAD      = (byte) 0xAB;

    // ─── Protocolo DVRIP (fallback AP) ────────────────────────────────────────
    private static final String XM_AP_IP    = "192.168.10.1";
    private static final int    DVRIP_PORT  = 34567;
    private static final byte   DVRIP_MAGIC = (byte) 0xFF;
    private static final int    MSG_LOGIN   = 1000;
    private static final int    MSG_SET_CFG = 1040;
    private static final int    DVRIP_OK    = 100;

    // ─── API VigiaEscolar ─────────────────────────────────────────────────────
    private static final int[]  API_PORTS   = {3001, 7003, 80, 8080};
    private static final int[]  SCAN_PORTS  = {34567, 554, 34571, 8554};

    // ─── Cores institucionais VigiaEscolar ────────────────────────────────────
    private static final int COLOR_BG       = Color.rgb(245, 247, 251);
    private static final int COLOR_CARD     = Color.WHITE;
    private static final int COLOR_TEXT     = Color.rgb(17, 24, 39);
    private static final int COLOR_MUTED    = Color.rgb(100, 116, 139);
    private static final int COLOR_BORDER   = Color.rgb(226, 232, 240);
    private static final int COLOR_GREEN    = Color.rgb(0, 138, 59);    // #008a3b
    private static final int COLOR_BLUE     = Color.rgb(18, 53, 90);    // #12355a
    private static final int COLOR_BLUE_MED = Color.rgb(0, 103, 176);   // #0067b0
    private static final int COLOR_SUCCESS  = Color.rgb(220, 252, 231);
    private static final int COLOR_ERROR    = Color.rgb(254, 226, 226);
    private static final int COLOR_WARN_BG  = Color.rgb(255, 251, 235);
    private static final int COLOR_WARN_BDR = Color.rgb(253, 230, 138);

    // ─── Log buffer (debug) ───────────────────────────────────────────────────
    private final List<String> logBuffer = new ArrayList<>();
    private ScrollView logScrollView;

    // ─── Estado BLE ───────────────────────────────────────────────────────────
    private BluetoothAdapter   bleAdapter;   // usado para API legada startLeScan
    private BluetoothLeScanner bleScanner;   // usado como fallback (nova API)
    private BluetoothGatt      bleGatt;
    private boolean            bleScanning   = false;
    private boolean            bleConnected  = false;
    private boolean            bleConnecting = false;  // evita conexões paralelas
    private String             connectedDevSn   = null;
    private String             connectedMac     = null;
    private final Set<String>  foundDevices = new HashSet<>();
    // Guarda o BluetoothDevice do ScanResult — necessário para MACs aleatórios (Android 12+)
    private final java.util.Map<String, BluetoothDevice> scannedDevices = new java.util.HashMap<>();

    // Aguardando resposta BLE (AUTH ou WIFI_CFG)
    private volatile boolean waitingBleResponse = false;
    private final Handler    mainHandler   = new Handler(Looper.getMainLooper());

    // Receiver para bond state — usado no fluxo createBond → connectGatt
    private BroadcastReceiver bondReceiver = null;

    // ─── Estado de reconnect (replica iCSee bleReconnectTimer) ───────────────
    private int     reconnectAttempts   = 0;
    private static final int RECONNECT_MAX_ATTEMPTS = 3;       // como iCSee: até 3 tentativas
    private static final long RECONNECT_DELAY_MS    = 3_000L;  // 3s entre tentativas
    private String  reconnectMac        = null;
    private String  reconnectName       = null;
    private boolean reconnectActive     = false;
    private Runnable reconnectRunnable  = null;
    private boolean authPasswordSent    = false;  // controla erro miss_token (auth não respondida)

    // ─── Estado API ───────────────────────────────────────────────────────────
    private volatile String  apiToken      = null;
    private volatile String  selectedSchoolId = null;

    // ─── Pool de threads ──────────────────────────────────────────────────────
    private final ExecutorService pool  = Executors.newFixedThreadPool(24);
    private final AtomicInteger   seqNo = new AtomicInteger(0);

    // ─── Widgets ──────────────────────────────────────────────────────────────
    private LinearLayout bleDeviceList;
    private LinearLayout networkList;
    private LinearLayout logBle;
    private LinearLayout apiList;
    private LinearLayout schoolList;

    private EditText wifiSsidInput;
    private EditText wifiPassInput;
    private EditText cameraPassInput;  // senha da câmera (padrão: vazio)
    private EditText cameraIpInput;    // para modo fallback AP
    private EditText cameraUserInput;
    private EditText cameraApPassInput;
    private EditText apiUrlInput;
    private EditText emailInput;
    private EditText appPasswordInput;
    private EditText cameraNameInput;
    private EditText cameraLocInput;
    private EditText schoolInput;

    private TextView statusBle;
    private TextView statusApi;
    private Button   bleScanButton;

    // ─── Lifecycle ────────────────────────────────────────────────────────────

    @Override
    protected void onCreate(Bundle bundle) {
        super.onCreate(bundle);
        requestNeededPermissions();
        buildUi();
        initBle();
        discoverApis();
    }

    @Override
    protected void onDestroy() {
        stopBleScan();
        disconnectBle();
        unregisterBondReceiver();
        pool.shutdownNow();
        super.onDestroy();
    }

    // ─── Construção da UI ─────────────────────────────────────────────────────

    @SuppressLint("SetTextI18n")
    private void buildUi() {
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setBackgroundColor(COLOR_BG);

        LinearLayout root = vStack();
        root.setPadding(dp(16), dp(16), dp(16), dp(40));
        scroll.addView(root);

        // ── Header institucional ─────────────────────────────────────────────
        LinearLayout header = new LinearLayout(this);
        header.setOrientation(LinearLayout.VERTICAL);
        header.setPadding(dp(18), dp(16), dp(18), dp(16));
        header.setBackground(rounded(COLOR_BLUE, COLOR_BLUE, 14));
        root.addView(header, matchWrap(0, 0, 0, dp(18)));

        // Linha logo + título
        LinearLayout hRow = new LinearLayout(this);
        hRow.setOrientation(LinearLayout.HORIZONTAL);
        hRow.setGravity(Gravity.CENTER_VERTICAL);

        View dot = new View(this);
        dot.setBackground(rounded(COLOR_GREEN, COLOR_GREEN, 6));
        hRow.addView(dot, new LinearLayout.LayoutParams(dp(12), dp(12)));

        TextView hTitle = tv("VigiaEscolar", 20, Color.WHITE, true);
        hTitle.setPadding(dp(10), 0, 0, 0);
        hRow.addView(hTitle);
        header.addView(hRow);

        TextView hSub = tv("Configurador de Câmera XM / iCSee", 13, Color.argb(200, 255, 255, 255), false);
        hSub.setPadding(0, dp(4), 0, 0);
        header.addView(hSub);

        // ── PASSO 1: Busca BLE ───────────────────────────────────────────────
        LinearLayout bleCard = card();
        bleCard.addView(stepRow("1", "Localizar câmera via Bluetooth"));
        bleCard.addView(muted("O app escaneia dispositivos Bluetooth próximos que sejam câmeras XM/iCSee (Service 0x1910). Coloque a câmera em modo de pareamento (LED piscando) antes de buscar."));

        bleScanButton = primaryBtn("Buscar câmeras BLE", v -> toggleBleScan());
        bleCard.addView(gap(bleScanButton, dp(10)));

        statusBle = statusChip("Aguardando...");
        bleCard.addView(gap(statusBle, dp(8)));

        bleDeviceList = vStack();
        bleCard.addView(gap(bleDeviceList, dp(4)));
        root.addView(bleCard);

        // ── PASSO 2: Wi-Fi da escola ─────────────────────────────────────────
        LinearLayout wifiCard = card();
        wifiCard.addView(stepRow("2", "Rede Wi-Fi da escola"));
        wifiCard.addView(muted("Rede Wi-Fi que a câmera vai usar após ser configurada. Use a rede da escola (não a do celular)."));
        wifiSsidInput = input("Nome da rede (SSID)");
        wifiPassInput = inputPass("Senha da rede Wi-Fi");
        wifiCard.addView(field("SSID", wifiSsidInput));
        wifiCard.addView(field("Senha da rede", wifiPassInput));
        root.addView(wifiCard);

        // ── PASSO 3: Configurar via BLE ──────────────────────────────────────
        LinearLayout configCard = card();
        configCard.addView(stepRow("3", "Configurar câmera via Bluetooth"));
        configCard.addView(muted("Selecione a câmera encontrada no Passo 1 e toque em configurar. O app enviará o Wi-Fi da escola diretamente para a câmera via BLE."));
        cameraPassInput = inputPass("Senha da câmera (padrão: vazio)");
        configCard.addView(field("Senha da câmera XM", cameraPassInput));

        // Painel de log com scroll + botão copiar
        LinearLayout logHeader = new LinearLayout(this);
        logHeader.setOrientation(LinearLayout.HORIZONTAL);
        logHeader.setGravity(Gravity.CENTER_VERTICAL);
        logHeader.setLayoutParams(matchWrap(0, dp(10), 0, dp(4)));

        TextView logTitle = tv("Log de diagnóstico", 11, COLOR_MUTED, true);
        logTitle.setLayoutParams(new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        logHeader.addView(logTitle);

        Button copyBtn = new Button(this);
        copyBtn.setText("Copiar logs");
        copyBtn.setAllCaps(false);
        copyBtn.setTextSize(11);
        copyBtn.setTextColor(COLOR_BLUE_MED);
        copyBtn.setTypeface(Typeface.DEFAULT_BOLD);
        copyBtn.setPadding(dp(10), dp(4), dp(10), dp(4));
        copyBtn.setBackground(rounded(Color.rgb(219, 234, 254), Color.rgb(147, 197, 253), 8));
        copyBtn.setOnClickListener(v -> copyLogsToClipboard());
        LinearLayout.LayoutParams copyParams = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        logHeader.addView(copyBtn, copyParams);

        Button clearBtn = new Button(this);
        clearBtn.setText("Limpar");
        clearBtn.setAllCaps(false);
        clearBtn.setTextSize(11);
        clearBtn.setTextColor(COLOR_MUTED);
        clearBtn.setPadding(dp(8), dp(4), dp(8), dp(4));
        clearBtn.setBackground(rounded(COLOR_BG, COLOR_BORDER, 8));
        clearBtn.setOnClickListener(v -> clearLogs());
        LinearLayout.LayoutParams clearParams = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        clearParams.leftMargin = dp(6);
        logHeader.addView(clearBtn, clearParams);

        configCard.addView(logHeader);

        logScrollView = new ScrollView(this);
        logScrollView.setBackgroundColor(Color.rgb(15, 23, 42));
        GradientDrawable logBg = new GradientDrawable();
        logBg.setColor(Color.rgb(15, 23, 42));
        logBg.setCornerRadius(dp(8));
        logScrollView.setBackground(logBg);
        logScrollView.setPadding(dp(10), dp(8), dp(10), dp(8));
        LinearLayout.LayoutParams scrollParams = matchWrap(0, 0, 0, 0);
        scrollParams.height = dp(220);
        logScrollView.setLayoutParams(scrollParams);

        logBle = vStack();
        logScrollView.addView(logBle);
        configCard.addView(logScrollView);

        root.addView(configCard);

        // ── Fallback: modo AP ─────────────────────────────────────────────────
        LinearLayout apCard = card();
        apCard.addView(apBanner("Alternativa: Modo AP (sem Bluetooth)"));
        apCard.addView(muted("Se não houver Bluetooth disponível, conecte o celular diretamente no hotspot da câmera (rede IPCamera_XXXXXX, senha 1234567890) e use o protocolo DVRIP pelo IP."));
        apCard.addView(gap(secondaryBtn("Abrir configurações Wi-Fi", v -> openWifiSettings()), dp(8)));
        cameraIpInput   = input("IP da câmera AP (padrão: 192.168.10.1)");
        cameraUserInput = input("Usuário (padrão: yura)");
        cameraApPassInput = inputPass("Senha da câmera");
        cameraIpInput.setText(XM_AP_IP);
        cameraUserInput.setText("yura");
        apCard.addView(field("IP", cameraIpInput));
        apCard.addView(field("Usuário", cameraUserInput));
        apCard.addView(field("Senha câmera", cameraApPassInput));
        apCard.addView(gap(secondaryBtn("Conectar via IP (DVRIP)", v -> apModeLogin()), dp(10)));
        networkList = vStack();
        apCard.addView(gap(secondaryBtn("Buscar câmeras na rede local", v -> scanLan()), dp(6)));
        apCard.addView(gap(networkList, dp(4)));
        root.addView(apCard);

        // ── PASSO 4: API VigiaEscolar ─────────────────────────────────────────
        LinearLayout apiCard = card();
        apiCard.addView(stepRow("4", "Login VigiaEscolar"));
        apiCard.addView(muted("Entre com o mesmo e-mail e senha do painel web. A API é detectada automaticamente na rede local."));
        apiUrlInput      = input("http://192.168.x.x:3001/api");
        emailInput       = input("email@escola.com");
        appPasswordInput = inputPass("Senha do painel web");
        statusApi = statusChip("Não conectado");

        apiCard.addView(gap(secondaryBtn("Detectar API na rede", v -> discoverApis()), dp(8)));
        apiList = vStack();
        apiCard.addView(apiList);
        apiCard.addView(field("URL da API", apiUrlInput));
        apiCard.addView(field("E-mail", emailInput));
        apiCard.addView(field("Senha", appPasswordInput));
        apiCard.addView(gap(statusApi, dp(8)));
        apiCard.addView(gap(primaryBtn("Entrar na API", v -> loginApi()), dp(4)));

        apiCard.addView(gap(sectionLbl("Escola para vincular a câmera"), dp(14)));
        schoolList = vStack();
        apiCard.addView(gap(schoolList, dp(4)));
        schoolInput = input("ID da escola selecionada");
        apiCard.addView(field("Escola (ID)", schoolInput));
        root.addView(apiCard);

        // ── PASSO 5: Cadastrar ────────────────────────────────────────────────
        LinearLayout regCard = card();
        regCard.addView(stepRow("5", "Cadastrar câmera"));
        regCard.addView(muted("Após a câmera conectar ao Wi-Fi da escola (LED fixo), informe o novo IP na rede local e finalize o cadastro."));
        cameraNameInput = input("Nome da câmera (ex: Entrada Principal)");
        cameraLocInput  = input("Localização (ex: Portão norte)");
        cameraNameInput.setText("Câmera XM iCSee");

        TextView tipFindIp = muted("Dica: após configurar, use a opção 'Buscar câmeras na rede local' na seção Alternativa acima para encontrar o novo IP da câmera.");
        regCard.addView(field("Nome", cameraNameInput));
        regCard.addView(field("Localização", cameraLocInput));
        regCard.addView(gap(tipFindIp, dp(8)));
        regCard.addView(gap(primaryBtn("Cadastrar no VigiaEscolar", v -> registerCamera()), dp(8)));
        root.addView(regCard);

        setContentView(scroll);
    }

    // ─── PASSO 1: BLE Scan ────────────────────────────────────────────────────

    private void initBle() {
        BluetoothManager mgr = (BluetoothManager) getSystemService(Context.BLUETOOTH_SERVICE);
        bleAdapter = mgr != null ? mgr.getAdapter() : null;
        if (bleAdapter == null || !bleAdapter.isEnabled()) {
            logBle("Bluetooth desativado. Ative o Bluetooth e abra o app novamente.");
            if (bleScanButton != null) bleScanButton.setEnabled(false);
            return;
        }
        // Guarda também o scanner novo como fallback
        bleScanner = bleAdapter.getBluetoothLeScanner();
        logBle("Bluetooth LE pronto. Toque em 'Buscar câmeras BLE'.");
    }

    @SuppressLint("MissingPermission")
    private void toggleBleScan() {
        if (bleAdapter == null) {
            initBle();
            if (bleAdapter == null) { toast("Bluetooth não disponível"); return; }
        }
        if (bleScanning) stopBleScan();
        else startBleScan();
    }

    @SuppressLint("MissingPermission")
    private void startBleScan() {
        stopReconnect();  // novo scan manual cancela reconnect em andamento
        foundDevices.clear();
        scannedDevices.clear();
        bleDeviceList.removeAllViews();
        bleScanning = true;
        bleScanButton.setText("Parar busca BLE");
        setChip(statusBle, "Escaneando... (60s)", COLOR_BLUE_MED);
        logBle("Buscando câmeras XM/iCSee... Coloque a câmera em modo de emparelhamento (LED piscando).");

        // Usa API legada startLeScan — exatamente como o app iCSee original
        // Isso produz BluetoothDevice com tipo correto, ao contrário de BluetoothLeScanner
        boolean started = bleAdapter.startLeScan(legacyScanCallback);
        logBle("startLeScan (API legada): " + (started ? "OK" : "falhou — tentando API nova"));
        if (!started && bleScanner != null) {
            bleScanner.startScan(newScanCallback);
            logBle("BluetoothLeScanner (API nova) iniciado como fallback");
        }

        mainHandler.postDelayed(this::stopBleScan, 60_000);
    }

    @SuppressLint("MissingPermission")
    private void stopBleScan() {
        mainHandler.removeCallbacks(this::stopBleScan);
        if (bleAdapter != null) {
            try { bleAdapter.stopLeScan(legacyScanCallback); } catch (Exception ignored) {}
        }
        if (bleScanner != null) {
            try { bleScanner.stopScan(newScanCallback); } catch (Exception ignored) {}
        }
        bleScanning = false;
        if (bleScanButton != null) bleScanButton.setText("Buscar câmeras BLE");
        if (statusBle != null && !bleConnected) {
            int count = bleDeviceList != null ? bleDeviceList.getChildCount() : 0;
            setChip(statusBle, count > 0 ? "Scan encerrado — " + count + " dispositivo(s)" : "Nenhuma câmera encontrada", COLOR_MUTED);
        }
    }

    // API legada — exatamente como o iCSee usa internamente (via BluetoothKit/inuker)
    @SuppressLint("MissingPermission")
    private final BluetoothAdapter.LeScanCallback legacyScanCallback = (device, rssi, scanRecord) -> {
        if (device == null) return;
        String mac  = device.getAddress();
        String name = device.getName();

        if ((name == null || name.isEmpty()) && scanRecord != null) {
            name = parseLocalName(scanRecord);
        }

        // Critério REAL do iCSee (engenharia reversa e.n.d.c.a):
        //  Câmera XM = Manufacturer Specific Data (AD 0xFF) contém "8B8B8B8B"
        // Dispositivos sem esse marker são genéricos e não respondem ao serviço 0x1910.
        boolean isXmCamera  = hasXmManufacturerMarker(scanRecord);
        boolean hasXmService = hasServiceUuid(scanRecord, UUID_SERVICE);

        String upperName = name != null ? name.toUpperCase(Locale.US) : "";
        boolean nameMatch = upperName.contains("IPC") || upperName.contains("XM")
                || upperName.contains("CAMERA") || upperName.contains("ICSEE")
                || upperName.contains("CAM");

        // Aceita: câmera XM confirmada (marker), serviço 0x1910 anunciado, OU nome reconhecido
        // RSSI sozinho não basta — devices BLE quaisquer ficam próximos
        if (!isXmCamera && !hasXmService && !nameMatch) return;

        scannedDevices.put(mac, device);
        if (!foundDevices.add(mac)) return;

        String finalName = (name != null && !name.isEmpty()) ? name : ("BLE " + mac.substring(mac.length() - 5));
        boolean confirmed = isXmCamera || hasXmService;
        int finalRssi = rssi;
        String tag = isXmCamera ? " [XM-CAM✓]" : (hasXmService ? " [SVC1910]" : " [nome]");
        logBle("Encontrado [legacyScan] tipo=" + device.getType() + " " + finalName + " " + mac + " " + rssi + "dBm" + tag);
        // Log raw scanRecord (apenas para device candidato) — ajuda diagnóstico
        if (scanRecord != null) {
            String hex = bytesToHex(scanRecord);
            logBle("  raw scanRecord: " + (hex.length() > 80 ? hex.substring(0, 80) + "..." : hex));
        }
        runOnUiThread(() -> addBleDevice(finalName, mac, finalRssi, confirmed, false));
    };

    // Nova API — fallback caso startLeScan falhe
    private final ScanCallback newScanCallback = new ScanCallback() {
        @SuppressLint("MissingPermission")
        @Override
        public void onScanResult(int callbackType, ScanResult result) {
            BluetoothDevice device = result.getDevice();
            String mac  = device.getAddress();
            String name = device.getName();
            byte[] raw  = result.getScanRecord() != null ? result.getScanRecord().getBytes() : null;
            if (name == null && result.getScanRecord() != null)
                name = result.getScanRecord().getDeviceName();

            boolean isXmCamera  = hasXmManufacturerMarker(raw);
            boolean hasXmService = false;
            if (result.getScanRecord() != null && result.getScanRecord().getServiceUuids() != null)
                for (android.os.ParcelUuid u : result.getScanRecord().getServiceUuids())
                    if (u.getUuid().equals(UUID_SERVICE)) { hasXmService = true; break; }

            String upperName = name != null ? name.toUpperCase(Locale.US) : "";
            boolean nameMatch = upperName.contains("IPC") || upperName.contains("XM")
                    || upperName.contains("CAMERA") || upperName.contains("ICSEE")
                    || upperName.contains("CAM");
            if (!isXmCamera && !hasXmService && !nameMatch) return;

            scannedDevices.put(mac, device);
            if (!foundDevices.add(mac)) return;

            String finalName = (name != null && !name.isEmpty()) ? name : ("BLE " + mac.substring(mac.length() - 5));
            int rssi = result.getRssi();
            boolean confirmed = isXmCamera || hasXmService;
            String tag = isXmCamera ? " [XM-CAM✓]" : (hasXmService ? " [SVC1910]" : " [nome]");
            logBle("Encontrado [newScan] tipo=" + device.getType() + " " + finalName + " " + mac + " " + rssi + "dBm" + tag);
            runOnUiThread(() -> addBleDevice(finalName, mac, rssi, confirmed, false));
        }

        @Override
        public void onScanFailed(int errorCode) {
            runOnUiThread(() -> logBle("✗ newScan falhou código=" + errorCode));
        }
    };

    // Extrai nome local do advertising packet raw (AD type 0x08 ou 0x09)
    private String parseLocalName(byte[] ad) {
        if (ad == null) return null;
        int i = 0;
        while (i < ad.length - 1) {
            int len = ad[i] & 0xFF;
            if (len == 0) break;
            if (i + len >= ad.length) break;
            int type = ad[i + 1] & 0xFF;
            if (type == 0x08 || type == 0x09) {
                try { return new String(ad, i + 2, len - 1, StandardCharsets.UTF_8); }
                catch (Exception ignored) {}
            }
            i += len + 1;
        }
        return null;
    }

    // Verifica se um UUID de 128 bits está nos service UUIDs do advertising packet
    private boolean hasServiceUuid(byte[] ad, UUID target) {
        if (ad == null) return false;
        // Verifica pelo UUID completo em little-endian no packet
        byte[] targetBytes = uuidToLe(target);
        String adHex = bytesToHex(ad);
        String targetHex = bytesToHex(targetBytes);
        return adHex.contains(targetHex);
    }

    // Detecta câmera XM via marker "8B8B8B8B" no Manufacturer Data (AD type 0xFF).
    // Engenharia reversa do iCSee (classe e.n.d.c.a) confirmou que apenas câmeras
    // cujo manufacturer specific data contém esse padrão são consideradas câmeras
    // XM válidas para conexão BLE. Dispositivos sem esse marker são genéricos
    // (não respondem a connectGatt no serviço 0x1910).
    private boolean hasXmManufacturerMarker(byte[] ad) {
        if (ad == null || ad.length < 6) return false;
        int i = 0;
        while (i < ad.length - 1) {
            int len = ad[i] & 0xFF;
            if (len == 0) break;
            if (i + len >= ad.length) break;
            int type = ad[i + 1] & 0xFF;
            // AD type 0xFF = Manufacturer Specific Data
            if (type == 0xFF && len > 2) {
                try {
                    String payload = new String(ad, i + 2, len - 1, StandardCharsets.UTF_8);
                    if (payload.contains("8B8B8B8B")) return true;
                } catch (Exception ignored) {}
                // Também checa em hex caso o payload não seja UTF-8
                String hex = bytesToHex(java.util.Arrays.copyOfRange(ad, i + 2, i + 1 + len)).toUpperCase(Locale.US);
                if (hex.contains("38423842384238423842")  // "8B8B8B8B" em ASCII hex
                        || hex.contains("8B8B8B8B")) return true;
            }
            i += len + 1;
        }
        return false;
    }

    private byte[] uuidToLe(UUID uuid) {
        ByteBuffer buf = ByteBuffer.allocate(16).order(ByteOrder.LITTLE_ENDIAN);
        buf.putLong(uuid.getLeastSignificantBits());
        buf.putLong(uuid.getMostSignificantBits());
        return buf.array();
    }

    private String bytesToHex(byte[] b) {
        StringBuilder sb = new StringBuilder();
        for (byte v : b) sb.append(String.format("%02x", v));
        return sb.toString();
    }

    @SuppressLint("MissingPermission")
    private void addBleDevice(String name, String mac, int rssi, boolean confirmed, boolean randomMac) {
        String tag = confirmed ? "[XM ✓] " : "[BLE] ";
        String macNote = randomMac ? " [MAC aleatório]" : "";
        String label = tag + name + "\n" + mac + macNote + "   " + rssi + " dBm\nToque para conectar";
        Button btn = listBtn(label, v -> {
            stopBleScan();
            connectBleDevice(mac, name);
        });
        bleDeviceList.addView(btn);
        logBle("Encontrado: " + name + " (" + mac + ") " + rssi + " dBm" + (confirmed ? " [XM]" : ""));
    }

    // ─── PASSO 3: Conexão BLE e configuração WiFi ─────────────────────────────

    @SuppressLint("MissingPermission")
    private void connectBleDevice(String mac, String name) {
        if (bleConnecting || bleConnected) {
            logBle("⚠ Já existe uma conexão em andamento — ignorando toque duplo.");
            return;
        }
        bleConnecting = true;
        if (bleGatt != null) {
            try { bleGatt.disconnect(); } catch (Exception ignored) {}
            try { bleGatt.close(); } catch (Exception ignored) {}
            bleGatt = null;
        }
        bleConnected = false;
        connectedDevSn = null;
        connectedMac = mac;
        authPasswordSent = false;
        // Guarda dados para o reconnect timer (replica iCSee bleReconnectTimer)
        if (!reconnectActive) {
            reconnectMac      = mac;
            reconnectName     = name;
            reconnectAttempts = 0;
        }

        logBle("Conectando em " + name + " (" + mac + ")...");
        setChip(statusBle, "Parando scan...", COLOR_BLUE_MED);

        BluetoothManager mgr = (BluetoothManager) getSystemService(Context.BLUETOOTH_SERVICE);
        BluetoothAdapter adapter = mgr != null ? mgr.getAdapter() : null;
        if (adapter == null || !adapter.isEnabled()) {
            logBle("✗ Bluetooth desligado.");
            bleConnecting = false;
            return;
        }

        // Fluxo clonado do iCSee v7.1.1 (engenharia reversa do classes2.dex e.l.a.a.k.d.h):
        //   1. Para QUALQUER scan em andamento (startLeScan E BluetoothLeScanner)
        //   2. Aguarda 500ms para o stack BT do Android processar o stop
        //   3. Cria device via adapter.getRemoteDevice(mac) — NÃO usa cache do scan
        //   4. Chama connectGatt(ctx, false, cb, TRANSPORT_LE) no MAIN THREAD
        //
        // Pontos críticos descobertos:
        //   - Conectar enquanto scaneia bloqueia silenciosamente (sem callback)
        //   - getRemoteDevice é mais confiável que cached do ScanResult para câmeras XM
        //   - connectGatt DEVE ser do main thread em algumas marcas (Xiaomi/Huawei)
        //   - autoConnect=false + TRANSPORT_LE é o que o iCSee usa (confirmado)
        stopBleScan();
        try { adapter.cancelDiscovery(); } catch (Exception ignored) {}

        mainHandler.postDelayed(() -> {
            try {
                BluetoothDevice device = adapter.getRemoteDevice(mac);
                logBle("Device obtido via getRemoteDevice. Tipo: " + device.getType());
                setChip(statusBle, "Conectando...", COLOR_BLUE_MED);
                doConnectGatt(device);
            } catch (Exception e) {
                logBle("✗ Erro getRemoteDevice: " + e.getMessage());
                bleConnecting = false;
                setChip(statusBle, "Erro endereço inválido", Color.rgb(185, 28, 28));
            }
        }, 600);
    }

    private void unregisterBondReceiver() {
        if (bondReceiver != null) {
            try { unregisterReceiver(bondReceiver); } catch (Exception ignored) {}
            bondReceiver = null;
        }
    }

    @SuppressLint("MissingPermission")
    private void doConnectGatt(BluetoothDevice device) {
        logBle("connectGatt autoConnect=false TRANSPORT_LE deviceType=" + device.getType());
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            bleGatt = device.connectGatt(this, false, gattCallback, BluetoothDevice.TRANSPORT_LE);
        } else {
            bleGatt = device.connectGatt(this, false, gattCallback);
        }
        logBle("connectGatt retornou: " + (bleGatt != null ? "OK" : "NULL"));

        if (bleGatt == null) {
            logBle("✗ connectGatt null — reinicie o Bluetooth e tente novamente.");
            bleConnecting = false;
            runOnUiThread(() -> setChip(statusBle, "Erro: connectGatt null", Color.rgb(185, 28, 28)));
            return;
        }

        logBle("Aguardando onConnectionStateChange... timeout=30s");
        mainHandler.postDelayed(() -> {
            if (!bleConnected && bleGatt != null) {
                logBle("✗ Timeout 30s — onConnectionStateChange nunca chamado.");
                logBle("   deviceType=" + device.getType() + " mac=" + device.getAddress());
                bleConnecting = false;
                try { bleGatt.disconnect(); bleGatt.close(); } catch (Exception ignored) {}
                bleGatt = null;
                scheduleReconnect("timeout 30s connectGatt");
            }
        }, 30_000);
    }

    // ─── Reconnect timer (replica iCSee bleReconnectTimer) ─────────────────────
    // O iCSee reagenda até 3 tentativas de connectGatt em caso de falha — strings
    // "reconnect Timer start" e "close bleReconnectTimer" no bytecode confirmam.
    private void scheduleReconnect(String reason) {
        if (reconnectMac == null) return;
        if (reconnectAttempts >= RECONNECT_MAX_ATTEMPTS) {
            logBle("✗ Reconnect: limite de " + RECONNECT_MAX_ATTEMPTS + " tentativas atingido (" + reason + ")");
            setChip(statusBle, "Falha após " + RECONNECT_MAX_ATTEMPTS + " tentativas", Color.rgb(185, 28, 28));
            stopReconnect();
            return;
        }
        reconnectAttempts++;
        reconnectActive = true;
        logBle("⟳ reconnect Timer start — tentativa " + reconnectAttempts + "/" + RECONNECT_MAX_ATTEMPTS + " em " + (RECONNECT_DELAY_MS/1000) + "s (" + reason + ")");
        setChip(statusBle, "Reconectando (" + reconnectAttempts + "/" + RECONNECT_MAX_ATTEMPTS + ")", COLOR_BLUE_MED);
        if (reconnectRunnable != null) mainHandler.removeCallbacks(reconnectRunnable);
        final String mac = reconnectMac;
        final String name = reconnectName;
        reconnectRunnable = () -> {
            if (!reconnectActive) return;
            bleConnecting = false;  // libera flag para connectBleDevice prosseguir
            bleConnected  = false;
            connectBleDevice(mac, name);
        };
        mainHandler.postDelayed(reconnectRunnable, RECONNECT_DELAY_MS);
    }

    private void stopReconnect() {
        if (reconnectActive) logBle("close bleReconnectTimer");
        reconnectActive   = false;
        reconnectAttempts = 0;
        reconnectMac      = null;
        reconnectName     = null;
        if (reconnectRunnable != null) {
            mainHandler.removeCallbacks(reconnectRunnable);
            reconnectRunnable = null;
        }
    }

    // Limpa o cache de serviços GATT via reflection — workaround usado pelo iCSee/BluetoothKit
    // Evita que o Android use serviços em cache de uma conexão anterior com o mesmo device
    private void refreshDeviceCache(BluetoothGatt gatt) {
        try {
            java.lang.reflect.Method refresh = gatt.getClass().getMethod("refresh");
            boolean result = (boolean) refresh.invoke(gatt);
            logBle("refreshDeviceCache: " + result);
        } catch (Exception e) {
            logBle("refreshDeviceCache não disponível: " + e.getMessage());
        }
    }

    @SuppressLint("MissingPermission")
    private void disconnectBle() {
        stopReconnect();  // disconnect manual cancela timer de reconnect
        if (bleGatt != null) {
            try { bleGatt.disconnect(); } catch (Exception ignored) {}
            // fecha após pequeno delay para o stack BLE processar o disconnect
            BluetoothGatt g = bleGatt;
            mainHandler.postDelayed(() -> { try { g.close(); } catch (Exception ignored) {} }, 300);
            bleGatt = null;
        }
        bleConnected = false;
        bleConnecting = false;
        connectedDevSn = null;
    }

    private final BluetoothGattCallback gattCallback = new BluetoothGattCallback() {

        @SuppressLint("MissingPermission")
        @Override
        public void onConnectionStateChange(BluetoothGatt gatt, int status, int newState) {
            if (status != BluetoothGatt.GATT_SUCCESS) {
                int s = status;
                String hint = s == 133 ? " (câmera saiu do modo BLE — reinicie-a)" : s == 8 ? " (sinal perdido)" : "";
                runOnUiThread(() -> logBle("✗ connectBLEFailed status=" + s + hint));
                try { gatt.close(); } catch (Exception ignored) {}
                if (bleGatt == gatt) bleGatt = null;
                bleConnected  = false;
                bleConnecting = false;
                // iCSee dispatcha error_code_str="connectBLEFailed" → reagenda reconnect
                runOnUiThread(() -> scheduleReconnect("status=" + s));
                return;
            }
            if (newState == BluetoothProfile.STATE_CONNECTED) {
                bleConnecting = false;
                bleConnected  = true;
                stopReconnect();  // sucesso → cancela timer de reconnect
                runOnUiThread(() -> logBle("✓ STATE_CONNECTED! Limpando cache GATT e solicitando MTU..."));
                refreshDeviceCache(gatt);
                mainHandler.postDelayed(() -> {
                    try { gatt.requestMtu(512); } catch (Exception e) {
                        mainHandler.postDelayed(() -> { if (bleGatt == gatt) gatt.discoverServices(); }, 300);
                    }
                }, 200);
            } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                boolean wasConnected = bleConnected;
                bleConnected  = false;
                bleConnecting = false;
                runOnUiThread(() -> logBle("BLE desconectado."));
                try { gatt.close(); } catch (Exception ignored) {}
                if (bleGatt == gatt) bleGatt = null;
                // Se a câmera desconectar antes do auth completar, é falha de pareamento
                // (iCSee mostra "TR_Blue_pairing_failed_miss_token"). Reagenda reconnect.
                if (wasConnected && !authPasswordSent) {
                    runOnUiThread(() -> {
                        logBle("⚠ TR_Blue_pairing_failed_miss_token — desconectou antes do auth");
                        scheduleReconnect("disconnect antes do auth");
                    });
                } else {
                    runOnUiThread(() -> setChip(statusBle, "Desconectado", COLOR_MUTED));
                }
            }
        }

        @SuppressLint("MissingPermission")
        @Override
        public void onMtuChanged(BluetoothGatt gatt, int mtu, int status) {
            runOnUiThread(() -> logBle("MTU negociado: " + mtu + " (status=" + status + "). Descobrindo serviços..."));
            // Passo 2: discoverServices após MTU
            mainHandler.postDelayed(() -> {
                if (bleGatt == gatt) {
                    try { gatt.discoverServices(); } catch (Exception e) {
                        runOnUiThread(() -> logBle("✗ Erro discoverServices: " + e.getMessage()));
                    }
                }
            }, 300);
        }

        @SuppressLint("MissingPermission")
        @Override
        public void onServicesDiscovered(BluetoothGatt gatt, int status) {
            if (status != BluetoothGatt.GATT_SUCCESS) {
                runOnUiThread(() -> logBle("✗ Falha ao descobrir serviços (status " + status + ")"));
                return;
            }

            BluetoothGattService svc = gatt.getService(UUID_SERVICE);
            if (svc == null) {
                StringBuilder sb = new StringBuilder();
                for (BluetoothGattService s : gatt.getServices()) sb.append("\n  ").append(s.getUuid());
                runOnUiThread(() -> logBle("✗ Serviço XM (0x1910) não encontrado. Services:" + sb));
                return;
            }

            runOnUiThread(() -> logBle("Serviço XM 0x1910 encontrado. Habilitando notificações..."));
            bleConnected = true;

            // Passo 3: habilitar notify em 0x2b11
            BluetoothGattCharacteristic notifyChar = svc.getCharacteristic(UUID_NOTIFY);
            if (notifyChar == null) {
                runOnUiThread(() -> logBle("✗ Characteristic notify 0x2b11 não encontrada."));
                return;
            }
            boolean ok = gatt.setCharacteristicNotification(notifyChar, true);
            runOnUiThread(() -> logBle("setCharacteristicNotification: " + ok));

            BluetoothGattDescriptor desc = notifyChar.getDescriptor(UUID_CCCD);
            if (desc == null) {
                runOnUiThread(() -> logBle("CCCD não encontrado — aguardando frame da câmera..."));
                // A câmera envia DEV_INFO primeiro; aguardamos via onCharacteristicChanged
                return;
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                gatt.writeDescriptor(desc, BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE);
            } else {
                desc.setValue(BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE);
                gatt.writeDescriptor(desc);
            }
        }

        @SuppressLint("MissingPermission")
        @Override
        public void onDescriptorWrite(BluetoothGatt gatt, BluetoothGattDescriptor descriptor, int status) {
            runOnUiThread(() -> logBle("CCCD write status=" + status + ". Aguardando DEV_INFO da câmera..."));
            // NÃO enviamos auth aqui. O protocolo XM exige aguardar o DEV_INFO que a câmera
            // envia por conta própria após notify habilitado. Timeout de 5s como fallback.
            mainHandler.postDelayed(() -> {
                if (bleConnected && connectedDevSn == null && bleGatt == gatt) {
                    runOnUiThread(() -> logBle("Timeout aguardando DEV_INFO — tentando auth com SN vazio..."));
                    sendAuthFrame(gatt);
                }
            }, 5_000);
        }

        @Override
        public void onCharacteristicChanged(BluetoothGatt gatt, BluetoothGattCharacteristic characteristic) {
            if (!UUID_NOTIFY.equals(characteristic.getUuid())) return;
            byte[] data = characteristic.getValue();
            if (data == null || data.length < 2) return;
            processIncoming(gatt, data);
        }

        @Override
        public void onCharacteristicChanged(BluetoothGatt gatt, BluetoothGattCharacteristic characteristic, byte[] value) {
            if (!UUID_NOTIFY.equals(characteristic.getUuid())) return;
            if (value == null || value.length < 2) return;
            processIncoming(gatt, value);
        }

        @Override
        public void onCharacteristicWrite(BluetoothGatt gatt, BluetoothGattCharacteristic characteristic, int status) {
            if (status != BluetoothGatt.GATT_SUCCESS) {
                runOnUiThread(() -> logBle("✗ Falha ao escrever BLE (status " + status + ")"));
            }
        }
    };

    private void processIncoming(BluetoothGatt gatt, byte[] data) {
        // Log raw hex para diagnóstico
        StringBuilder hex = new StringBuilder();
        int show = Math.min(data.length, 16);
        for (int i = 0; i < show; i++) hex.append(String.format("%02X ", data[i]));
        String hexStr = hex.toString().trim() + (data.length > 16 ? "..." : "");
        runOnUiThread(() -> logBle("← BLE [" + data.length + "b] " + hexStr));

        if (data.length < 2) return;
        byte funId = data[1];

        runOnUiThread(() -> {
            if (funId == FUN_AUTH_RSP) {
                handleAuthResponse(gatt, data);
            } else if (funId == FUN_WIFI_RSP) {
                handleWifiResponse(data);
            } else if (funId == FUN_DEV_INFO) {
                handleDevInfo(gatt, data);
            } else {
                // Frame desconhecido — pode ser DEV_INFO com funId diferente neste firmware
                // Tenta extrair string JSON do payload para diagnóstico
                if (data.length > 5) {
                    try {
                        String raw = new String(data, 5, data.length - 5, StandardCharsets.UTF_8).trim();
                        if (!raw.isEmpty()) logBle("  payload: " + raw.substring(0, Math.min(raw.length(), 120)));
                    } catch (Exception ignored) {}
                }
            }
        });
    }

    // ─── Protocolo BLE XM ─────────────────────────────────────────────────────

    @SuppressLint("MissingPermission")
    private void sendAuthFrame(BluetoothGatt gatt) {
        String pass  = cameraPassInput.getText().toString().trim();
        String devSn = connectedDevSn != null ? connectedDevSn : "";

        // Token: AES-CBC-128-PKCS7(key=MD5(sn)[0:16], iv=zeros, plain=pass+random4hex)
        // Se SN desconhecido, usa key derivada de string vazia (câmera aceita para autenticação inicial)
        String token = encBleToken(devSn, pass);
        byte[] payload = token.getBytes(StandardCharsets.UTF_8);
        byte[] frame   = buildBleFrame(FUN_AUTH_REQ, payload);

        logBle("→ AUTH token=" + token.substring(0, Math.min(token.length(), 16)) + "... SN=" + (devSn.isEmpty() ? "(aguardando)" : devSn));
        authPasswordSent = true;  // marca que entrou no fluxo de auth (evita reconnect miss_token)
        writeBluetoothChar(gatt, frame);
    }

    private void handleAuthResponse(BluetoothGatt gatt, byte[] data) {
        // Byte 5 = resultado: 0x00 = ok
        boolean ok = data.length >= 6 && data[5] == 0x00;
        if (ok) {
            logBle("✓ Auth aceito. Enviando configuração Wi-Fi...");
            sendWifiFrame(gatt);
        } else {
            int ret = data.length >= 6 ? (data[5] & 0xFF) : -1;
            logBle("✗ Auth recusado (ret=0x" + String.format("%02X", ret) + ")");
            if (ret == 0x01) logBle("  → Senha da câmera incorreta");
            else if (ret == 0x02) logBle("  → SN inválido");
            else logBle("  → Verifique a senha da câmera no campo 'Senha da câmera XM'");
        }
    }

    private void handleDevInfo(BluetoothGatt gatt, byte[] data) {
        // A câmera envia seu SN após notify habilitado
        // Payload (bytes 5+): JSON ou string com o SN
        if (data.length > 5) {
            try {
                String raw = new String(data, 5, data.length - 5, StandardCharsets.UTF_8).trim();
                logBle("DEV_INFO payload: " + raw.substring(0, Math.min(raw.length(), 100)));
                // Tenta extrair SN de JSON {"SN":"...","..."}
                if (raw.startsWith("{")) {
                    JSONObject obj = new JSONObject(raw);
                    String sn = obj.optString("SN", obj.optString("sn", obj.optString("SerialNo", "")));
                    if (!sn.isEmpty()) connectedDevSn = sn;
                } else {
                    // Formato simples: SN direto ou "SN,modelo,..."
                    connectedDevSn = raw.split("[,;|\\s]")[0].trim();
                }
                if (connectedDevSn != null && !connectedDevSn.isEmpty()) {
                    logBle("Serial da câmera: " + connectedDevSn);
                }
            } catch (Exception e) {
                logBle("DEV_INFO parse error: " + e.getMessage());
            }
        }
        // Agora que temos o SN, envia auth
        mainHandler.removeCallbacksAndMessages(null); // cancela timeout
        sendAuthFrame(gatt);
    }

    @SuppressLint("MissingPermission")
    private void sendWifiFrame(BluetoothGatt gatt) {
        String ssid     = wifiSsidInput.getText().toString().trim();
        String wifiPass = wifiPassInput.getText().toString().trim();

        if (ssid.isEmpty()) {
            logBle("✗ Informe o SSID (Passo 2) antes de configurar.");
            return;
        }

        // Valores confirmados na decompilação do APK iCSee v7.1.1 — usa "WPA2" e não "WPA2PSK"
        String encrypType = wifiPass.isEmpty() ? "OPEN"    : "WPA2";
        String keyType    = wifiPass.isEmpty() ? "NONE"    : "AES";
        String auth       = wifiPass.isEmpty() ? "OPEN"    : "WPA2";

        try {
            JSONObject wifi = new JSONObject();
            wifi.put("SSID",       ssid);
            wifi.put("Keys",       wifiPass);
            wifi.put("NetType",    "DHCP");
            wifi.put("EncrypType", encrypType);
            wifi.put("KeyType",    keyType);
            wifi.put("Auth",       auth);
            wifi.put("Enable",     true);
            wifi.put("HostIP",     "0.0.0.0");
            wifi.put("GateWay",    "0.0.0.0");
            wifi.put("Submask",    "255.255.255.0");

            // Wrapper com chave "NetWork.Wifi" como o SDK original usa
            JSONObject wrapper = new JSONObject();
            wrapper.put("NetWork.Wifi", wifi);

            byte[] payload = wrapper.toString().getBytes(StandardCharsets.UTF_8);
            byte[] frame   = buildBleFrame(FUN_WIFI_CFG, payload);
            writeBluetoothChar(gatt, frame);
            logBle("→ WiFi cfg enviado: SSID=" + ssid + " enc=" + encrypType);
        } catch (Exception e) {
            logBle("✗ Erro ao montar frame WiFi: " + e.getMessage());
        }
    }

    private void handleWifiResponse(byte[] data) {
        boolean ok = data.length >= 6 && data[5] == 0x00;
        if (ok) {
            logBle("✓ Câmera aceitou a rede Wi-Fi! Aguarde ela conectar (LED fixo).");
            setChip(statusBle, "Wi-Fi configurado ✓", COLOR_GREEN);
            mainHandler.postDelayed(this::disconnectBle, 1000);
            toast("Câmera configurada! Aguarde conectar ao Wi-Fi da escola.");
        } else {
            int ret = data.length >= 6 ? (data[5] & 0xFF) : -1;
            logBle("✗ Câmera recusou WiFi (ret=0x" + String.format("%02X", ret) + "). Verifique SSID/senha.");
            setChip(statusBle, "Falha Wi-Fi", Color.rgb(185, 28, 28));
        }
    }

    /**
     * Token de autenticação BLE XM — replica Fun_EncBleToken do libFunSDK.so:
     *  key  = MD5(sn)[0..15]  (16 bytes, SN como string UTF-8)
     *  iv   = zeros (16 bytes)
     *  plain = password + randomHex4  (padded PKCS7 para múltiplo de 16)
     * Retorna hex string uppercase do ciphertext
     * Se SN vazio, usa chave derivada da SDK key "alexa20211018"
     */
    private String encBleToken(String sn, String password) {
        try {
            // Deriva chave AES: MD5 do SN (16 bytes)
            MessageDigest md = MessageDigest.getInstance("MD5");
            String keySource = sn.isEmpty() ? "alexa20211018" : sn;
            byte[] aesKey = md.digest(keySource.getBytes(StandardCharsets.UTF_8)); // 16 bytes

            // Plaintext: password + salt aleatório de 4 hex chars
            String salt = String.format(Locale.US, "%04X", new Random().nextInt(0x10000));
            String plain = password + salt;

            // Encrypt AES-CBC-128-PKCS7
            Cipher cipher = Cipher.getInstance("AES/CBC/PKCS5Padding");
            SecretKeySpec keySpec = new SecretKeySpec(aesKey, "AES");
            IvParameterSpec ivSpec = new IvParameterSpec(new byte[16]);
            cipher.init(javax.crypto.Cipher.ENCRYPT_MODE, keySpec, ivSpec);
            byte[] encrypted = cipher.doFinal(plain.getBytes(StandardCharsets.UTF_8));

            // Converte para hex uppercase
            StringBuilder sb = new StringBuilder();
            for (byte b : encrypted) sb.append(String.format("%02X", b));
            return sb.toString();
        } catch (Exception e) {
            logBle("✗ Erro ao gerar token: " + e.getMessage());
            // Fallback: token vazio (câmera de fábrica pode aceitar)
            return "";
        }
    }

    /**
     * Frame BLE XM: [HEAD=0xAB][VERSION=0x00][FUN_ID_LO][FUN_ID_HI][LEN_LO][LEN_HI][CHECKSUM][DATA]
     * Estrutura revelada pela análise do APK — 7 bytes de header, não 5.
     * CHECKSUM = XOR de todos os bytes de HEAD até LEN (inclusive).
     */
    private byte[] buildBleFrame(byte funId, byte[] data) {
        int dataLen = data != null ? data.length : 0;
        byte[] frame = new byte[7 + dataLen];
        frame[0] = BLE_HEAD;      // 0xAB
        frame[1] = 0x00;          // VERSION
        frame[2] = funId;         // FUN_ID_LO (16-bit, byte baixo)
        frame[3] = 0x00;          // FUN_ID_HI
        frame[4] = (byte) (dataLen & 0xFF);         // LEN_LO
        frame[5] = (byte) ((dataLen >> 8) & 0xFF);  // LEN_HI
        // CHECKSUM = XOR dos primeiros 6 bytes do header
        byte cs = 0;
        for (int i = 0; i < 6; i++) cs ^= frame[i];
        frame[6] = cs;
        if (data != null) System.arraycopy(data, 0, frame, 7, dataLen);
        return frame;
    }

    // Mantido para compatibilidade com código de fallback DVRIP
    @SuppressWarnings("unused")
    private byte[] buildBleFrameOld(byte funId, byte[] data) {
        int dataLen = data != null ? data.length : 0;
        byte[] frame = new byte[5 + dataLen];
        frame[0] = BLE_HEAD;
        frame[1] = funId;
        frame[2] = (byte) (dataLen & 0xFF);
        frame[3] = (byte) ((dataLen >> 8) & 0xFF);
        int checksum = 0;
        for (int i = 0; i < dataLen; i++) {
            frame[5 + i] = data[i];
            checksum = (checksum + (data[i] & 0xFF)) & 0xFF;
        }
        frame[4] = (byte) checksum;
        return frame;
    }

    @SuppressLint("MissingPermission")
    private void writeBluetoothChar(BluetoothGatt gatt, byte[] data) {
        if (gatt == null) { logBle("BLE não conectado."); return; }
        BluetoothGattService svc = gatt.getService(UUID_SERVICE);
        if (svc == null) { logBle("Serviço XM não encontrado."); return; }
        BluetoothGattCharacteristic ch = svc.getCharacteristic(UUID_WRITE);
        if (ch == null) { logBle("Characteristic de escrita não encontrada."); return; }

        // API 33+ usa writeCharacteristic(ch, value, writeType)
        // Versões anteriores usam setValue + writeCharacteristic(ch)
        if (data.length <= 512) {
            writeChunk(gatt, ch, data, BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT);
        } else {
            // Fragmenta em chunks de 512 bytes (MTU máximo negociado)
            pool.execute(() -> {
                int offset = 0;
                while (offset < data.length) {
                    int end = Math.min(offset + 512, data.length);
                    byte[] chunk = Arrays.copyOfRange(data, offset, end);
                    writeChunk(gatt, ch, chunk, BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE);
                    offset = end;
                    try { Thread.sleep(50); } catch (InterruptedException ignored) {}
                }
            });
        }
    }

    @SuppressLint({"MissingPermission", "NewApi"})
    private void writeChunk(BluetoothGatt gatt, BluetoothGattCharacteristic ch, byte[] data, int writeType) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            gatt.writeCharacteristic(ch, data, writeType);
        } else {
            ch.setValue(data);
            ch.setWriteType(writeType);
            gatt.writeCharacteristic(ch);
        }
    }

    // ─── Fallback: Modo AP DVRIP ──────────────────────────────────────────────

    private void openWifiSettings() {
        startActivity(new Intent(Settings.ACTION_WIFI_SETTINGS));
    }

    private void apModeLogin() {
        String ip   = cameraIpInput.getText().toString().trim();
        String user = cameraUserInput.getText().toString().trim();
        String pass = cameraApPassInput.getText().toString().trim();
        String ssid = wifiSsidInput.getText().toString().trim();
        String wifiP = wifiPassInput.getText().toString().trim();

        if (ip.isEmpty()) { toast("Informe o IP da câmera"); return; }
        if (ssid.isEmpty()) { toast("Informe o SSID da rede (Passo 2)"); return; }

        logBle("Conectando via DVRIP em " + ip + "...");
        setChip(statusBle, "Conectando AP...", COLOR_BLUE_MED);

        pool.execute(() -> {
            try {
                dvripSetWifi(ip, user.isEmpty() ? "yura" : user, pass, ssid, wifiP);
                runOnUiThread(() -> {
                    logBle("✓ Wi-Fi enviado via DVRIP! Aguarde câmera reconectar.");
                    setChip(statusBle, "Wi-Fi AP configurado ✓", COLOR_GREEN);
                    toast("Wi-Fi configurado via DVRIP");
                });
            } catch (Exception e) {
                runOnUiThread(() -> {
                    logBle("✗ Falha DVRIP: " + e.getMessage());
                    setChip(statusBle, "Erro DVRIP", Color.rgb(185, 28, 28));
                });
            }
        });
    }

    private void scanLan() {
        networkList.removeAllViews();
        pool.execute(() -> {
            List<String> ips = localSubnetIps();
            if (ips.isEmpty()) {
                runOnUiThread(() -> networkList.addView(tv("Rede local não detectada.", 13, COLOR_MUTED, false)));
                return;
            }
            for (String ip : ips) {
                pool.execute(() -> {
                    for (int port : SCAN_PORTS) {
                        if (isOpen(ip, port, 400)) {
                            runOnUiThread(() -> {
                                Button b = listBtn(ip + "  (porta " + port + ")", v -> {
                                    cameraIpInput.setText(ip);
                                    toast("IP preenchido: " + ip);
                                });
                                networkList.addView(b);
                            });
                            break;
                        }
                    }
                });
            }
        });
    }

    // ─── DVRIP TCP (protocolo XM porta 34567) ─────────────────────────────────

    private void dvripSetWifi(String ip, String user, String pass, String ssid, String wifiPass) throws Exception {
        String auth    = wifiPass.isEmpty() ? "OPEN" : "WPA2";
        String encType = wifiPass.isEmpty() ? "NONE" : "AES";

        try (Socket socket = new Socket()) {
            socket.connect(new InetSocketAddress(ip, DVRIP_PORT), 4000);
            socket.setSoTimeout(8000);
            InputStream in = socket.getInputStream();
            OutputStream out = socket.getOutputStream();

            // Login
            JSONObject loginBody = new JSONObject();
            loginBody.put("EncryptType", "MD5");
            loginBody.put("LoginType", "DVRIP-Web");
            loginBody.put("PassWord", dvripMd5(pass));
            loginBody.put("UserName", user);
            loginBody.put("SessionID", "0x0000000000");
            dvripSend(out, 0, seqNo.getAndIncrement(), MSG_LOGIN, loginBody.toString().getBytes(StandardCharsets.UTF_8));

            JSONObject loginRsp = dvripRead(in);
            int ret = loginRsp.optInt("Ret", -1);
            if (ret != DVRIP_OK && ret != 101) throw new Exception("Login DVRIP rejeitado (Ret=" + ret + ")");
            String sid = loginRsp.optString("SessionID", "0x0");
            int sessionInt = parseHex(sid);

            // SetConfig NetWork.Wifi
            JSONObject wifiCfg = new JSONObject();
            wifiCfg.put("Enable", true);
            wifiCfg.put("SSID", ssid);
            wifiCfg.put("Auth", auth);
            wifiCfg.put("EncrypType", encType);
            wifiCfg.put("KeyType", 0);
            wifiCfg.put("Keys", wifiPass);
            wifiCfg.put("NetType", "DHCP");
            wifiCfg.put("HostIP", "0.0.0.0");
            wifiCfg.put("GateWay", "0.0.0.0");
            wifiCfg.put("Submask", "0.0.0.0");

            JSONObject cfgBody = new JSONObject();
            cfgBody.put("Name", "NetWork.Wifi");
            cfgBody.put("SessionID", sid);
            cfgBody.put("NetWork.Wifi", wifiCfg);
            dvripSend(out, sessionInt, seqNo.getAndIncrement(), MSG_SET_CFG, cfgBody.toString().getBytes(StandardCharsets.UTF_8));

            JSONObject cfgRsp = dvripRead(in);
            int cfgRet = cfgRsp.optInt("Ret", -1);
            if (cfgRet != DVRIP_OK) throw new Exception("SetConfig rejeitado (Ret=" + cfgRet + ")");
        }
    }

    private void dvripSend(OutputStream out, int sessionId, int seq, int msgId, byte[] body) throws Exception {
        ByteBuffer hdr = ByteBuffer.allocate(20).order(ByteOrder.LITTLE_ENDIAN);
        hdr.put(DVRIP_MAGIC); hdr.put((byte) 0x01); hdr.put((byte) 0x00); hdr.put((byte) 0x00);
        hdr.putInt(sessionId); hdr.putInt(seq);
        hdr.put((byte) 0x00); hdr.put((byte) 0x00); hdr.put((byte) 0x00); hdr.put((byte) 0x00);
        hdr.putShort((short) msgId);
        hdr.putInt(body.length + 2);
        out.write(hdr.array()); out.write(body); out.write('\r'); out.write('\n'); out.flush();
    }

    private JSONObject dvripRead(InputStream in) throws Exception {
        byte[] hdr = readExact(in, 20);
        ByteBuffer buf = ByteBuffer.wrap(hdr).order(ByteOrder.LITTLE_ENDIAN);
        buf.get(); buf.get(); buf.getShort(); buf.getInt(); buf.getInt();
        buf.get(); buf.get(); buf.get(); buf.get(); buf.getShort();
        int bodyLen = buf.getInt();
        if (bodyLen < 0 || bodyLen > 65536) throw new Exception("Frame DVRIP inválido");
        byte[] body = readExact(in, bodyLen);
        int end = bodyLen;
        while (end > 0 && (body[end - 1] == '\r' || body[end - 1] == '\n' || body[end - 1] == 0)) end--;
        String s = new String(body, 0, end, StandardCharsets.UTF_8);
        return s.isEmpty() ? new JSONObject() : new JSONObject(s);
    }

    private byte[] readExact(InputStream in, int count) throws Exception {
        byte[] buf = new byte[count];
        int read = 0;
        while (read < count) {
            int r = in.read(buf, read, count - read);
            if (r < 0) throw new Exception("Conexão encerrada (lido " + read + "/" + count + ")");
            read += r;
        }
        return buf;
    }

    private String dvripMd5(String input) {
        try {
            MessageDigest md = MessageDigest.getInstance("MD5");
            byte[] digest = md.digest(input.getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder();
            for (byte b : digest) sb.append(String.format("%02X", b));
            return sb.length() >= 8 ? sb.substring(0, 8) : sb.toString();
        } catch (Exception e) { return ""; }
    }

    private int parseHex(String s) {
        try {
            s = s.trim();
            return (int) Long.parseLong(s.startsWith("0x") || s.startsWith("0X") ? s.substring(2) : s, 16);
        } catch (Exception e) { return 0; }
    }

    // ─── PASSO 4: API VigiaEscolar ────────────────────────────────────────────

    private void discoverApis() {
        if (apiList != null) {
            apiList.removeAllViews();
            apiList.addView(tv("Buscando API na rede...", 12, COLOR_MUTED, false));
        }
        pool.execute(() -> {
            List<String> ips = localSubnetIps();
            String local = wifiIp();
            if (local != null && !ips.contains(local)) ips.add(0, local);
            for (String ip : ips) {
                for (int port : API_PORTS) {
                    pool.execute(() -> probeApi(ip, port));
                }
            }
        });
    }

    private void probeApi(String ip, int port) {
        String url = "http://" + ip + ":" + port + "/api";
        try {
            HttpURLConnection c = (HttpURLConnection) new URL(url + "/health").openConnection();
            c.setRequestMethod("GET"); c.setConnectTimeout(700); c.setReadTimeout(700);
            if (c.getResponseCode() < 300 && readStream(c.getInputStream()).contains("vigiaescolar-api")) {
                runOnUiThread(() -> {
                    if (apiList != null) apiList.removeAllViews();
                    Button b = listBtn(url, v -> { apiUrlInput.setText(url); toast("API selecionada"); });
                    if (apiList != null) apiList.addView(b);
                    if (apiUrlInput.getText().toString().trim().isEmpty()) {
                        apiUrlInput.setText(url);
                        toast("API detectada: " + url);
                    }
                });
            }
        } catch (Exception ignored) {}
    }

    private void loginApi() {
        String url   = apiUrlInput.getText().toString().trim().replaceAll("/$", "");
        String email = emailInput.getText().toString().trim();
        String pass  = appPasswordInput.getText().toString().trim();
        if (url.isEmpty() || email.isEmpty() || pass.isEmpty()) { toast("Preencha URL, e-mail e senha"); return; }
        setChip(statusApi, "Entrando...", COLOR_BLUE_MED);
        pool.execute(() -> {
            try {
                JSONObject body = new JSONObject();
                body.put("email", email); body.put("password", pass);
                HttpURLConnection c = (HttpURLConnection) new URL(url + "/auth/login").openConnection();
                c.setRequestMethod("POST");
                c.setRequestProperty("Content-Type", "application/json");
                c.setRequestProperty("Accept", "application/json");
                c.setConnectTimeout(6000); c.setReadTimeout(8000); c.setDoOutput(true);
                c.getOutputStream().write(body.toString().getBytes(StandardCharsets.UTF_8));
                int code = c.getResponseCode();
                if (code >= 300) throw new Exception("HTTP " + code);
                String token = findToken(new JSONObject(readStream(c.getInputStream())));
                if (token.isEmpty()) throw new Exception("Token não encontrado na resposta");
                apiToken = token;
                runOnUiThread(() -> {
                    setChip(statusApi, "Conectado ✓", COLOR_GREEN);
                    toast("Login realizado");
                    fetchSchools(url, token);
                });
            } catch (Exception e) {
                runOnUiThread(() -> {
                    setChip(statusApi, "Erro: " + e.getMessage(), Color.rgb(185, 28, 28));
                    toast("Falha no login: " + e.getMessage());
                });
            }
        });
    }

    private void fetchSchools(String apiUrl, String token) {
        pool.execute(() -> {
            try {
                HttpURLConnection c = (HttpURLConnection) new URL(apiUrl + "/schools").openConnection();
                c.setRequestMethod("GET");
                c.setRequestProperty("Accept", "application/json");
                c.setRequestProperty("Authorization", "Bearer " + token);
                c.setConnectTimeout(6000); c.setReadTimeout(8000);
                if (c.getResponseCode() >= 300) throw new Exception("HTTP " + c.getResponseCode());
                String raw = readStream(c.getInputStream()).trim();
                JSONArray arr = raw.startsWith("[") ? new JSONArray(raw)
                    : new JSONObject(raw).optJSONArray("data");
                if (arr == null) arr = new JSONArray();
                JSONArray finalArr = arr;
                runOnUiThread(() -> showSchools(finalArr));
            } catch (Exception e) {
                runOnUiThread(() -> toast("Erro ao carregar escolas: " + e.getMessage()));
            }
        });
    }

    private void showSchools(JSONArray schools) {
        schoolList.removeAllViews();
        if (schools.length() == 0) {
            schoolList.addView(tv("Nenhuma escola encontrada.", 13, COLOR_MUTED, false)); return;
        }
        if (schools.length() == 1) {
            JSONObject s = schools.optJSONObject(0);
            if (s != null) {
                selectedSchoolId = s.optString("id", "");
                schoolInput.setText(selectedSchoolId);
                schoolList.addView(successBadge("Escola: " + s.optString("nome", s.optString("name", "Escola"))));
            }
            return;
        }
        for (int i = 0; i < schools.length(); i++) {
            JSONObject s = schools.optJSONObject(i);
            if (s == null) continue;
            String id = s.optString("id", "");
            String name = s.optString("nome", s.optString("name", "Escola"));
            schoolList.addView(listBtn(name + "\n" + id, v -> {
                selectedSchoolId = id; schoolInput.setText(id); toast("Escola: " + name);
            }));
        }
    }

    // ─── PASSO 5: Cadastrar câmera ────────────────────────────────────────────

    private void registerCamera() {
        String apiUrl   = apiUrlInput.getText().toString().trim().replaceAll("/$", "");
        String schoolId = schoolInput.getText().toString().trim();
        String name     = cameraNameInput.getText().toString().trim();
        String loc      = cameraLocInput.getText().toString().trim();
        String ip       = cameraIpInput.getText().toString().trim();

        if (apiToken == null || apiToken.isEmpty()) { toast("Faça login na API (Passo 4)"); return; }
        if (schoolId.isEmpty()) { toast("Selecione uma escola (Passo 4)"); return; }
        if (name.isEmpty()) { toast("Informe o nome da câmera"); return; }
        if (ip.isEmpty()) ip = "DHCP"; // IP ainda não conhecido (câmera acabou de conectar)

        String finalIp  = ip;
        String finalLoc = loc.isEmpty() ? "Configurada via APK" : loc;
        String rtspUrl  = "rtsp://" + finalIp + ":554/user={username}_password={password}_channel=1_stream=0.sdp?real_stream";

        pool.execute(() -> {
            try {
                JSONObject payload = new JSONObject();
                payload.put("nome", name);
                payload.put("escolaId", schoolId);
                payload.put("localizacao", finalLoc);
                payload.put("tipo", "RTSP");
                payload.put("url", rtspUrl);
                payload.put("porta", 554);
                payload.put("resolucao", "1080p");
                payload.put("fps", 30);
                payload.put("status", "Ativa");
                payload.put("usuario", "yura");
                payload.put("senha", cameraPassInput.getText().toString().trim());
                if (connectedDevSn != null) payload.put("serialNo", connectedDevSn);

                HttpURLConnection c = (HttpURLConnection) new URL(apiUrl + "/cameras").openConnection();
                c.setRequestMethod("POST");
                c.setRequestProperty("Content-Type", "application/json");
                c.setRequestProperty("Accept", "application/json");
                c.setRequestProperty("Authorization", "Bearer " + apiToken);
                c.setConnectTimeout(8000); c.setReadTimeout(8000); c.setDoOutput(true);
                c.getOutputStream().write(payload.toString().getBytes(StandardCharsets.UTF_8));

                int code = c.getResponseCode();
                if (code >= 200 && code < 300) {
                    runOnUiThread(() -> toast("✓ Câmera '" + name + "' cadastrada!"));
                } else {
                    String err = "";
                    try { err = readStream(c.getErrorStream()); } catch (Exception ignored) {}
                    String finalErr = err;
                    runOnUiThread(() -> toast("Erro ao cadastrar: HTTP " + code + " — " + finalErr));
                }
            } catch (Exception e) {
                runOnUiThread(() -> toast("Erro: " + e.getMessage()));
            }
        });
    }

    // ─── Utilitários de rede ──────────────────────────────────────────────────

    private boolean isOpen(String ip, int port, int ms) {
        try (Socket s = new Socket()) { s.connect(new InetSocketAddress(ip, port), ms); return true; }
        catch (Exception ignored) { return false; }
    }

    private List<String> localSubnetIps() {
        String local = wifiIp();
        if (local == null) local = firstPrivateIpv4();
        if (local == null) return Collections.emptyList();
        String[] p = local.split("\\.");
        if (p.length != 4) return Collections.emptyList();
        String prefix = p[0] + "." + p[1] + "." + p[2] + ".";
        List<String> list = new ArrayList<>();
        for (int i = 1; i <= 254; i++) { String ip = prefix + i; if (!ip.equals(local)) list.add(ip); }
        return list;
    }

    private String wifiIp() {
        WifiManager w = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
        if (w == null || w.getConnectionInfo() == null) return null;
        int v = w.getConnectionInfo().getIpAddress();
        if (v == 0) return null;
        return String.format(Locale.US, "%d.%d.%d.%d", v & 255, v >> 8 & 255, v >> 16 & 255, v >> 24 & 255);
    }

    private String firstPrivateIpv4() {
        try {
            for (NetworkInterface nif : Collections.list(NetworkInterface.getNetworkInterfaces()))
                for (java.net.InetAddress a : Collections.list(nif.getInetAddresses())) {
                    String ip = a.getHostAddress();
                    if (!a.isLoopbackAddress() && ip != null && ip.matches("^(10\\.|192\\.168\\.|172\\.(1[6-9]|2\\d|3[01])\\.).*"))
                        return ip;
                }
        } catch (Exception ignored) {}
        return null;
    }

    private String readStream(InputStream in) throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[4096]; int n;
        while ((n = in.read(buf)) >= 0) out.write(buf, 0, n);
        return out.toString("UTF-8");
    }

    private String findToken(JSONObject j) {
        for (String k : new String[]{"accessToken", "token", "jwt", "access_token"}) {
            String v = j.optString(k, ""); if (!v.isEmpty()) return v;
        }
        JSONObject d = j.optJSONObject("data"); if (d != null) return findToken(d);
        JSONObject s = j.optJSONObject("session"); if (s != null) return findToken(s);
        return "";
    }

    // ─── Permissões ───────────────────────────────────────────────────────────

    private void requestNeededPermissions() {
        if (Build.VERSION.SDK_INT < 23) return;
        List<String> need = new ArrayList<>(Arrays.asList(
            Manifest.permission.ACCESS_FINE_LOCATION,
            Manifest.permission.ACCESS_WIFI_STATE,
            Manifest.permission.CHANGE_WIFI_STATE
        ));
        if (Build.VERSION.SDK_INT >= 31) {
            need.add(Manifest.permission.BLUETOOTH_SCAN);
            need.add(Manifest.permission.BLUETOOTH_CONNECT);
        }
        List<String> missing = new ArrayList<>();
        for (String p : need) if (checkSelfPermission(p) != PackageManager.PERMISSION_GRANTED) missing.add(p);
        if (!missing.isEmpty()) requestPermissions(missing.toArray(new String[0]), 70);
    }

    // ─── UI helpers ──────────────────────────────────────────────────────────

    private LinearLayout vStack() {
        LinearLayout l = new LinearLayout(this);
        l.setOrientation(LinearLayout.VERTICAL);
        return l;
    }

    private LinearLayout card() {
        LinearLayout c = vStack();
        c.setPadding(dp(16), dp(16), dp(16), dp(16));
        c.setBackground(rounded(COLOR_CARD, COLOR_BORDER, 14));
        c.setLayoutParams(matchWrap(0, 0, 0, dp(14)));
        return c;
    }

    private View stepRow(String num, String label) {
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setLayoutParams(matchWrap(0, 0, 0, dp(10)));

        TextView badge = new TextView(this);
        badge.setText(num);
        badge.setTextSize(11);
        badge.setTextColor(Color.WHITE);
        badge.setTypeface(Typeface.DEFAULT_BOLD);
        badge.setGravity(Gravity.CENTER);
        badge.setBackground(rounded(COLOR_GREEN, COLOR_GREEN, 12));
        row.addView(badge, new LinearLayout.LayoutParams(dp(24), dp(24)));

        TextView lbl = tv(label, 16, COLOR_BLUE, true);
        lbl.setPadding(dp(10), 0, 0, 0);
        row.addView(lbl);
        return row;
    }

    private View apBanner(String label) {
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setPadding(dp(10), dp(8), dp(10), dp(8));
        row.setBackground(rounded(COLOR_WARN_BG, COLOR_WARN_BDR, 8));
        row.setLayoutParams(matchWrap(0, 0, 0, dp(10)));

        TextView lbl = tv(label, 14, Color.rgb(146, 64, 14), true);
        row.addView(lbl);
        return row;
    }

    private TextView tv(String text, float size, int color, boolean bold) {
        TextView v = new TextView(this);
        v.setText(text);
        v.setTextSize(size);
        v.setTextColor(color);
        if (bold) v.setTypeface(Typeface.DEFAULT_BOLD);
        return v;
    }

    private TextView muted(String text) {
        TextView v = tv(text, 13, COLOR_MUTED, false);
        v.setLineSpacing(0, 1.15f);
        v.setLayoutParams(matchWrap(0, 0, 0, dp(10)));
        return v;
    }

    private TextView sectionLbl(String text) {
        return tv(text, 12, COLOR_MUTED, true);
    }

    private TextView statusChip(String text) {
        TextView v = tv(text, 12, COLOR_MUTED, false);
        v.setPadding(dp(10), dp(6), dp(10), dp(6));
        v.setBackground(rounded(COLOR_BG, COLOR_BORDER, 8));
        return v;
    }

    private View successBadge(String text) {
        TextView v = tv(text, 13, COLOR_GREEN, true);
        v.setPadding(dp(10), dp(8), dp(10), dp(8));
        v.setBackground(rounded(COLOR_SUCCESS, Color.rgb(134, 239, 172), 8));
        v.setLayoutParams(matchWrap(0, dp(4), 0, 0));
        return v;
    }

    private void setChip(TextView chip, String text, int color) {
        chip.setText(text);
        chip.setTextColor(color);
        int bg, border;
        if (color == COLOR_GREEN) { bg = COLOR_SUCCESS; border = Color.rgb(134, 239, 172); }
        else if (color == COLOR_BLUE_MED) { bg = Color.rgb(219, 234, 254); border = Color.rgb(147, 197, 253); }
        else if (color == Color.rgb(185, 28, 28)) { bg = COLOR_ERROR; border = Color.rgb(252, 165, 165); }
        else { bg = COLOR_BG; border = COLOR_BORDER; }
        chip.setBackground(rounded(bg, border, 8));
    }

    private EditText input(String hint) {
        EditText e = new EditText(this);
        e.setHint(hint);
        e.setSingleLine(true);
        e.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD);
        e.setTextColor(COLOR_TEXT);
        e.setHintTextColor(Color.rgb(148, 163, 184));
        e.setTextSize(14);
        e.setPadding(dp(12), 0, dp(12), 0);
        e.setBackground(rounded(COLOR_BG, COLOR_BORDER, 10));
        e.setMinHeight(dp(48));
        return e;
    }

    private EditText inputPass(String hint) {
        EditText e = input(hint);
        e.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        return e;
    }

    private LinearLayout field(String label, EditText input) {
        LinearLayout box = vStack();
        box.setLayoutParams(matchWrap(0, dp(8), 0, 0));
        TextView lbl = tv(label, 11, COLOR_MUTED, true);
        lbl.setPadding(0, 0, 0, dp(4));
        box.addView(lbl);
        box.addView(input, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(48)));
        return box;
    }

    private Button primaryBtn(String label, View.OnClickListener l) {
        Button b = new Button(this);
        b.setText(label); b.setAllCaps(false);
        b.setTextColor(Color.WHITE); b.setTextSize(14);
        b.setTypeface(Typeface.DEFAULT_BOLD);
        b.setGravity(Gravity.CENTER);
        b.setPadding(dp(16), dp(10), dp(16), dp(10));
        b.setBackground(rounded(COLOR_GREEN, COLOR_GREEN, 10));
        b.setOnClickListener(l);
        return b;
    }

    private Button secondaryBtn(String label, View.OnClickListener l) {
        Button b = new Button(this);
        b.setText(label); b.setAllCaps(false);
        b.setTextColor(COLOR_BLUE_MED); b.setTextSize(13);
        b.setTypeface(Typeface.DEFAULT_BOLD);
        b.setGravity(Gravity.CENTER);
        b.setPadding(dp(14), dp(8), dp(14), dp(8));
        b.setBackground(rounded(Color.rgb(219, 234, 254), Color.rgb(147, 197, 253), 10));
        b.setOnClickListener(l);
        return b;
    }

    private Button listBtn(String label, View.OnClickListener l) {
        Button b = new Button(this);
        b.setText(label); b.setAllCaps(false);
        b.setTextColor(COLOR_TEXT); b.setTextSize(13);
        b.setGravity(Gravity.CENTER_VERTICAL | Gravity.START);
        b.setPadding(dp(12), dp(8), dp(12), dp(8));
        b.setBackground(rounded(Color.rgb(248, 250, 252), COLOR_BORDER, 10));
        b.setLayoutParams(matchWrap(0, dp(4), 0, 0));
        b.setOnClickListener(l);
        return b;
    }

    private View gap(View v, int topDp) {
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        p.topMargin = topDp;
        v.setLayoutParams(p);
        return v;
    }

    private LinearLayout.LayoutParams matchWrap(int l, int t, int r, int b) {
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        p.setMargins(l, t, r, b);
        return p;
    }

    private GradientDrawable rounded(int fill, int stroke, int radiusDp) {
        GradientDrawable d = new GradientDrawable();
        d.setColor(fill); d.setCornerRadius(dp(radiusDp)); d.setStroke(dp(1), stroke);
        return d;
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }

    @SuppressLint("DefaultLocale")
    private void logBle(String msg) {
        // Timestamp hh:mm:ss.ms
        long now = System.currentTimeMillis();
        java.util.Calendar cal = java.util.Calendar.getInstance();
        cal.setTimeInMillis(now);
        String ts = String.format("%02d:%02d:%02d.%03d",
            cal.get(java.util.Calendar.HOUR_OF_DAY),
            cal.get(java.util.Calendar.MINUTE),
            cal.get(java.util.Calendar.SECOND),
            cal.get(java.util.Calendar.MILLISECOND));

        String line = ts + "  " + msg;
        logBuffer.add(line);

        runOnUiThread(() -> {
            if (logBle == null) return;

            int color;
            if (msg.startsWith("✓"))       color = Color.rgb(52, 211, 153);   // verde claro
            else if (msg.startsWith("✗"))  color = Color.rgb(252, 129, 129);  // vermelho claro
            else if (msg.startsWith("←") || msg.startsWith("→")) color = Color.rgb(147, 197, 253); // azul claro
            else                           color = Color.rgb(148, 163, 184);   // cinza claro

            TextView v = new TextView(this);
            v.setText(line);
            v.setTextSize(11);
            v.setTextColor(color);
            v.setTypeface(android.graphics.Typeface.MONOSPACE);
            v.setPadding(0, dp(1), 0, dp(1));
            logBle.addView(v);

            // Auto-scroll para o final
            if (logScrollView != null) {
                logScrollView.post(() -> logScrollView.fullScroll(android.view.View.FOCUS_DOWN));
            }
        });
    }

    private void copyLogsToClipboard() {
        if (logBuffer.isEmpty()) {
            toast("Nenhum log para copiar");
            return;
        }
        StringBuilder sb = new StringBuilder();
        sb.append("=== VigiaEscolar BLE Debug Log ===\n");
        sb.append("Device: ").append(android.os.Build.MANUFACTURER).append(" ").append(android.os.Build.MODEL)
          .append(" API ").append(android.os.Build.VERSION.SDK_INT).append("\n");
        sb.append("MAC: ").append(connectedMac != null ? connectedMac : "N/A").append("\n");
        sb.append("==================================\n");
        for (String line : logBuffer) sb.append(line).append("\n");

        android.content.ClipboardManager clipboard =
            (android.content.ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
        android.content.ClipData clip =
            android.content.ClipData.newPlainText("VigiaEscolar BLE Log", sb.toString());
        clipboard.setPrimaryClip(clip);
        toast("✓ " + logBuffer.size() + " linhas copiadas para a área de transferência!");
    }

    private void clearLogs() {
        logBuffer.clear();
        if (logBle != null) logBle.removeAllViews();
        logBle("Log limpo.");
    }

    private void toast(String msg) { Toast.makeText(this, msg, Toast.LENGTH_LONG).show(); }
}
