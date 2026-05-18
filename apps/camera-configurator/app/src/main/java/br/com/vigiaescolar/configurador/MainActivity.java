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
import android.content.Context;
import android.content.Intent;
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

    // ─── Estado BLE ───────────────────────────────────────────────────────────
    private BluetoothLeScanner bleScanner;
    private BluetoothGatt      bleGatt;
    private boolean            bleScanning  = false;
    private boolean            bleConnected = false;
    private String             connectedDevSn   = null;
    private String             connectedMac     = null;
    private final Set<String>  foundDevices = new HashSet<>();

    // Aguardando resposta BLE (AUTH ou WIFI_CFG)
    private volatile boolean waitingBleResponse = false;
    private final Handler    mainHandler   = new Handler(Looper.getMainLooper());

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
        logBle = vStack();
        configCard.addView(field("Senha da câmera XM", cameraPassInput));
        configCard.addView(gap(logBle, dp(6)));
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
        BluetoothAdapter adapter = mgr != null ? mgr.getAdapter() : null;
        if (adapter == null || !adapter.isEnabled()) {
            logBle("Bluetooth desativado. Ative o Bluetooth e abra o app novamente.");
            if (bleScanButton != null) bleScanButton.setEnabled(false);
            return;
        }
        bleScanner = adapter.getBluetoothLeScanner();
        if (bleScanner == null) {
            logBle("Bluetooth LE não disponível neste dispositivo.");
            if (bleScanButton != null) bleScanButton.setEnabled(false);
        } else {
            logBle("Bluetooth LE pronto. Toque em 'Buscar câmeras BLE'.");
        }
    }

    @SuppressLint("MissingPermission")
    private void toggleBleScan() {
        // Reinicia o scanner caso o adapter tenha sido recriado (ex: BT desligou/ligou)
        if (bleScanner == null) {
            initBle();
            if (bleScanner == null) { toast("Bluetooth LE não disponível"); return; }
        }
        if (bleScanning) {
            stopBleScan();
        } else {
            startBleScan();
        }
    }

    @SuppressLint("MissingPermission")
    private void startBleScan() {
        if (bleScanner == null) return;
        foundDevices.clear();
        bleDeviceList.removeAllViews();
        bleScanning = true;
        bleScanButton.setText("Parar busca BLE");
        setChip(statusBle, "Escaneando... (60s)", COLOR_BLUE_MED);
        logBle("Buscando câmeras XM/iCSee... Coloque a câmera em modo de emparelhamento (LED piscando).");
        bleScanner.startScan(bleScanCallback);
        mainHandler.postDelayed(this::stopBleScan, 60_000);
    }

    @SuppressLint("MissingPermission")
    private void stopBleScan() {
        mainHandler.removeCallbacks(this::stopBleScan);
        if (bleScanner != null && bleScanning) {
            try { bleScanner.stopScan(bleScanCallback); } catch (Exception ignored) {}
        }
        bleScanning = false;
        if (bleScanButton != null) bleScanButton.setText("Buscar câmeras BLE");
        if (statusBle != null && !bleConnected) {
            int count = bleDeviceList != null ? bleDeviceList.getChildCount() : 0;
            setChip(statusBle, count > 0 ? "Scan encerrado — " + count + " câmera(s) encontrada(s)" : "Nenhuma câmera encontrada", COLOR_MUTED);
        }
    }

    private final ScanCallback bleScanCallback = new ScanCallback() {
        @SuppressLint("MissingPermission")
        @Override
        public void onScanResult(int callbackType, ScanResult result) {
            BluetoothDevice device = result.getDevice();
            String mac = device.getAddress();

            String name = device.getName();
            if (name == null || name.isEmpty()) {
                // Tenta pegar do ScanRecord
                if (result.getScanRecord() != null && result.getScanRecord().getDeviceName() != null) {
                    name = result.getScanRecord().getDeviceName();
                } else {
                    name = null;
                }
            }

            // Verifica se anuncia o service XM 0x1910
            boolean isXm = false;
            if (result.getScanRecord() != null) {
                List<android.os.ParcelUuid> uuids = result.getScanRecord().getServiceUuids();
                if (uuids != null) {
                    for (android.os.ParcelUuid u : uuids) {
                        if (u.getUuid().equals(UUID_SERVICE)) { isXm = true; break; }
                    }
                }
            }

            // Filtra: aceita se tem service XM, ou nome sugestivo, ou RSSI alto próximo (possível câmera sem nome)
            String upperName = name != null ? name.toUpperCase(Locale.US) : "";
            boolean nameMatch = upperName.contains("IPC") || upperName.contains("XM")
                    || upperName.contains("CAMERA") || upperName.contains("ICSEE")
                    || upperName.contains("CAM") || upperName.contains("VIGIA");
            boolean rssiClose = result.getRssi() >= -65; // muito próximo = provavelmente a câmera
            if (!isXm && !nameMatch && !rssiClose) return;

            if (!foundDevices.add(mac)) return; // já listado

            String finalName = name != null ? name : ("Dispositivo BLE " + mac.substring(mac.length() - 5));
            int rssi = result.getRssi();
            boolean finalIsXm = isXm;
            runOnUiThread(() -> addBleDevice(finalName, mac, rssi, finalIsXm));
        }

        @Override
        public void onScanFailed(int errorCode) {
            // Código 1 = já escaneando; 2 = app já usa scan; 3 = sem recurso; 4 = BT off
            String msg;
            switch (errorCode) {
                case 1:  msg = "Scan já em execução (reinicie o BT se travar)"; break;
                case 2:  msg = "Muitos apps escaneando ao mesmo tempo"; break;
                case 3:  msg = "Sem recurso de hardware para scan"; break;
                case 4:  msg = "Bluetooth desligado — ative e tente novamente"; break;
                default: msg = "Erro no scan BLE (código " + errorCode + ")";
            }
            runOnUiThread(() -> {
                logBle("✗ " + msg);
                setChip(statusBle, "Erro no scan", Color.rgb(185, 28, 28));
                bleScanning = false;
                if (bleScanButton != null) bleScanButton.setText("Buscar câmeras BLE");
            });
        }
    };

    @SuppressLint("MissingPermission")
    private void addBleDevice(String name, String mac, int rssi, boolean confirmed) {
        String tag = confirmed ? "[XM ✓] " : "[BLE] ";
        String label = tag + name + "\n" + mac + "   " + rssi + " dBm\nToque para conectar";
        Button btn = listBtn(label, v -> {
            // Para o scan antes de conectar — o stack BLE não gosta de scan + connect simultâneos
            stopBleScan();
            connectBleDevice(mac, name);
        });
        bleDeviceList.addView(btn);
        logBle("Encontrado: " + name + " (" + mac + ") " + rssi + " dBm" + (confirmed ? " [XM]" : ""));
    }

    // ─── PASSO 3: Conexão BLE e configuração WiFi ─────────────────────────────

    @SuppressLint("MissingPermission")
    private void connectBleDevice(String mac, String name) {
        // Fecha qualquer conexão anterior completamente antes de tentar nova
        if (bleGatt != null) {
            try { bleGatt.disconnect(); } catch (Exception ignored) {}
            try { bleGatt.close(); } catch (Exception ignored) {}
            bleGatt = null;
        }
        bleConnected = false;
        connectedDevSn = null;
        connectedMac = mac;

        logBle("Conectando em " + name + " (" + mac + ")...");
        logBle("(Se travar em 'Conectando', desligue/ligue o BT do celular e tente novamente)");
        setChip(statusBle, "Conectando...", COLOR_BLUE_MED);

        BluetoothManager mgr = (BluetoothManager) getSystemService(Context.BLUETOOTH_SERVICE);
        BluetoothAdapter adapter = mgr != null ? mgr.getAdapter() : null;
        if (adapter == null || !adapter.isEnabled()) {
            logBle("✗ Bluetooth desligado.");
            return;
        }

        BluetoothDevice device = adapter.getRemoteDevice(mac);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            bleGatt = device.connectGatt(this, false, gattCallback, BluetoothDevice.TRANSPORT_LE);
        } else {
            bleGatt = device.connectGatt(this, false, gattCallback);
        }

        // Timeout de 15s — se não conectar, avisa e fecha
        mainHandler.postDelayed(() -> {
            if (!bleConnected && bleGatt != null) {
                logBle("✗ Timeout de conexão (15s). A câmera pode ter saído do modo de emparelhamento.");
                logBle("   → Desligue e religue a câmera ou pressione o botão de reset para voltar ao modo BLE.");
                setChip(statusBle, "Timeout — reinicie a câmera", Color.rgb(185, 28, 28));
                try { bleGatt.disconnect(); bleGatt.close(); } catch (Exception ignored) {}
                bleGatt = null;
            }
        }, 15_000);
    }

    @SuppressLint("MissingPermission")
    private void disconnectBle() {
        if (bleGatt != null) {
            try { bleGatt.disconnect(); } catch (Exception ignored) {}
            // fecha após pequeno delay para o stack BLE processar o disconnect
            BluetoothGatt g = bleGatt;
            mainHandler.postDelayed(() -> { try { g.close(); } catch (Exception ignored) {} }, 300);
            bleGatt = null;
        }
        bleConnected = false;
        connectedDevSn = null;
    }

    private final BluetoothGattCallback gattCallback = new BluetoothGattCallback() {

        @SuppressLint("MissingPermission")
        @Override
        public void onConnectionStateChange(BluetoothGatt gatt, int status, int newState) {
            if (status != BluetoothGatt.GATT_SUCCESS) {
                // status 133 = GATT_ERROR (timeout/advertising stop), 8 = link loss
                int s = status;
                runOnUiThread(() -> logBle("Erro de conexão BLE (status=" + s + "). Tente novamente."));
                try { gatt.close(); } catch (Exception ignored) {}
                if (bleGatt == gatt) bleGatt = null;
                bleConnected = false;
                runOnUiThread(() -> setChip(statusBle, "Erro (status " + s + ")", Color.rgb(185, 28, 28)));
                return;
            }
            if (newState == BluetoothProfile.STATE_CONNECTED) {
                runOnUiThread(() -> logBle("BLE conectado. Descobrindo serviços..."));
                // Delay de 600ms antes de discoverServices — necessário em muitos dispositivos Android
                mainHandler.postDelayed(() -> {
                    if (bleGatt == gatt) {
                        try { gatt.discoverServices(); } catch (Exception e) {
                            logBle("Erro ao descobrir serviços: " + e.getMessage());
                        }
                    }
                }, 600);
            } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                bleConnected = false;
                runOnUiThread(() -> {
                    logBle("BLE desconectado.");
                    setChip(statusBle, "Desconectado", COLOR_MUTED);
                });
                try { gatt.close(); } catch (Exception ignored) {}
                if (bleGatt == gatt) bleGatt = null;
            }
        }

        @SuppressLint("MissingPermission")
        @Override
        public void onServicesDiscovered(BluetoothGatt gatt, int status) {
            if (status != BluetoothGatt.GATT_SUCCESS) {
                runOnUiThread(() -> logBle("Falha ao descobrir serviços (status " + status + ")"));
                return;
            }

            BluetoothGattService svc = gatt.getService(UUID_SERVICE);
            if (svc == null) {
                // Lista todos os services encontrados para diagnóstico
                StringBuilder sb = new StringBuilder("Services encontrados:");
                for (BluetoothGattService s : gatt.getServices()) sb.append("\n  ").append(s.getUuid());
                runOnUiThread(() -> logBle("Serviço XM (0x1910) não encontrado.\n" + sb));
                return;
            }

            runOnUiThread(() -> logBle("Serviço XM encontrado. Habilitando notificações..."));
            bleConnected = true;

            BluetoothGattCharacteristic notifyChar = svc.getCharacteristic(UUID_NOTIFY);
            if (notifyChar == null) {
                runOnUiThread(() -> logBle("Characteristic de notificação (0x2b11) não encontrada."));
                return;
            }
            gatt.setCharacteristicNotification(notifyChar, true);
            BluetoothGattDescriptor desc = notifyChar.getDescriptor(UUID_CCCD);
            if (desc != null) {
                // API 33+ usa writeDescriptor(desc, value); versões anteriores usam setValue + writeDescriptor
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    gatt.writeDescriptor(desc, BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE);
                } else {
                    desc.setValue(BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE);
                    gatt.writeDescriptor(desc);
                }
            } else {
                // CCCD não encontrado — tenta enviar auth mesmo assim
                runOnUiThread(() -> logBle("CCCD não encontrado, enviando auth diretamente..."));
                mainHandler.postDelayed(() -> sendAuthFrame(gatt), 200);
            }
        }

        @SuppressLint("MissingPermission")
        @Override
        public void onDescriptorWrite(BluetoothGatt gatt, BluetoothGattDescriptor descriptor, int status) {
            if (status != BluetoothGatt.GATT_SUCCESS) {
                runOnUiThread(() -> logBle("Aviso: CCCD write status=" + status + ", continuando mesmo assim..."));
            } else {
                runOnUiThread(() -> logBle("Notificações habilitadas."));
            }
            mainHandler.postDelayed(() -> sendAuthFrame(gatt), 200);
        }

        @Override
        public void onCharacteristicChanged(BluetoothGatt gatt, BluetoothGattCharacteristic characteristic) {
            if (!UUID_NOTIFY.equals(characteristic.getUuid())) return;
            // getValue() deprecated em API 33+; usa o overload com value param se disponível
            byte[] data = characteristic.getValue();
            if (data == null || data.length < 5) return;
            processIncoming(gatt, data);
        }

        // API 33+: overload com value diretamente
        @Override
        public void onCharacteristicChanged(BluetoothGatt gatt, BluetoothGattCharacteristic characteristic, byte[] value) {
            if (!UUID_NOTIFY.equals(characteristic.getUuid())) return;
            if (value == null || value.length < 5) return;
            processIncoming(gatt, value);
        }

        @Override
        public void onCharacteristicWrite(BluetoothGatt gatt, BluetoothGattCharacteristic characteristic, int status) {
            if (status != BluetoothGatt.GATT_SUCCESS) {
                runOnUiThread(() -> logBle("Falha ao escrever no BLE (status " + status + ")"));
            }
        }
    };

    private void processIncoming(BluetoothGatt gatt, byte[] data) {
        byte funId = data[1];
        runOnUiThread(() -> {
            logBle("← BLE recv funId=0x" + String.format("%02X", funId) + " len=" + data.length);
            if (funId == FUN_AUTH_RSP) {
                handleAuthResponse(gatt, data);
            } else if (funId == FUN_WIFI_RSP) {
                handleWifiResponse(data);
            } else if (funId == FUN_DEV_INFO) {
                handleDevInfo(data);
            }
        });
    }

    // ─── Protocolo BLE XM ─────────────────────────────────────────────────────

    @SuppressLint("MissingPermission")
    private void sendAuthFrame(BluetoothGatt gatt) {
        String pass = cameraPassInput.getText().toString().trim();
        // DevSN inicialmente desconhecido — usamos string vazia; a câmera responde com DEV_INFO
        String devSn = connectedDevSn != null ? connectedDevSn : "";
        String token = bleToken(devSn, pass);
        byte[] payload = token.getBytes(StandardCharsets.UTF_8);
        byte[] frame   = buildBleFrame(FUN_AUTH_REQ, payload);

        writeBluetoothChar(gatt, frame);
        logBle("Token de autenticação enviado...");
    }

    private void handleAuthResponse(BluetoothGatt gatt, byte[] data) {
        // data[5..] = payload da resposta
        // Byte 5 = código: 0x00 = ok, qualquer outro = falha
        boolean ok = data.length >= 6 && data[5] == 0x00;
        if (ok) {
            logBle("✓ Autenticação BLE bem-sucedida. Enviando Wi-Fi...");
            sendWifiFrame(gatt);
        } else {
            // Pode ser que o devSN veio na resposta (alguns firmwares enviam antes do auth)
            // Tenta re-autenticar com senha vazia
            logBle("Auth falhou (ret=" + (data.length >= 6 ? data[5] : -1) + "). Tentando sem senha...");
            cameraPassInput.setText("");
            sendAuthFrame(gatt);
        }
    }

    private void handleDevInfo(byte[] data) {
        // Extrai devSN do payload (string UTF-8 nos bytes 5..)
        if (data.length > 5) {
            String info = new String(data, 5, data.length - 5, StandardCharsets.UTF_8).trim();
            if (!info.isEmpty()) {
                connectedDevSn = info.split("[,;|]")[0].trim();
                logBle("Serial da câmera: " + connectedDevSn);
            }
        }
    }

    @SuppressLint("MissingPermission")
    private void sendWifiFrame(BluetoothGatt gatt) {
        String ssid     = wifiSsidInput.getText().toString().trim();
        String wifiPass = wifiPassInput.getText().toString().trim();

        if (ssid.isEmpty()) {
            logBle("Informe o SSID da rede Wi-Fi (Passo 2) antes de configurar.");
            return;
        }

        String auth    = wifiPass.isEmpty() ? "OPEN" : "WPA2";
        String encType = wifiPass.isEmpty() ? "NONE" : "AES";

        try {
            JSONObject wifi = new JSONObject();
            wifi.put("SSID",       ssid);
            wifi.put("Keys",       wifiPass);
            wifi.put("NetType",    "0");          // 0 = DHCP
            wifi.put("EncrypType", encType);
            wifi.put("Auth",       auth);
            wifi.put("Enable",     true);
            wifi.put("KeyType",    "");
            wifi.put("HostIP",     "0.0.0.0");
            wifi.put("GateWay",    "0.0.0.0");
            wifi.put("Submask",    "255.255.255.0");

            byte[] payload = wifi.toString().getBytes(StandardCharsets.UTF_8);
            byte[] frame   = buildBleFrame(FUN_WIFI_CFG, payload);
            writeBluetoothChar(gatt, frame);
            logBle("Configuração Wi-Fi enviada: " + ssid);
        } catch (Exception e) {
            logBle("Erro ao montar frame WiFi: " + e.getMessage());
        }
    }

    private void handleWifiResponse(byte[] data) {
        boolean ok = data.length >= 6 && data[5] == 0x00;
        if (ok) {
            logBle("✓ Câmera aceitou a rede Wi-Fi! Aguarde ela conectar (LED fixo).");
            setChip(statusBle, "Wi-Fi configurado ✓", COLOR_GREEN);
            disconnectBle();
            toast("Câmera configurada! Aguarde conectar ao Wi-Fi da escola.");
        } else {
            logBle("Câmera recusou a configuração Wi-Fi (ret=" + (data.length >= 6 ? data[5] : -1) + "). Verifique SSID e senha.");
            setChip(statusBle, "Falha Wi-Fi", Color.rgb(185, 28, 28));
        }
    }

    /**
     * Monta frame BLE XM:
     * [HEAD:1B=0xAB] [FUN_ID:1B] [LEN:2B LE] [CHECKSUM:1B] [DATA:N bytes]
     * CHECKSUM = soma de todos os bytes do DATA mod 256
     */
    private byte[] buildBleFrame(byte funId, byte[] data) {
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

    /**
     * Token de autenticação BLE:
     * MD5(devSN + password + randomHex4)[0..15] uppercase
     * Se devSN vazio (ainda não conhecido), usa só MD5(password + salt)
     */
    private String bleToken(String devSn, String password) {
        try {
            Random rnd = new Random();
            String salt = String.format(Locale.US, "%04X", rnd.nextInt(0x10000));
            String input = devSn + password + salt;
            MessageDigest md = MessageDigest.getInstance("MD5");
            byte[] digest = md.digest(input.getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder();
            for (byte b : digest) sb.append(String.format("%02X", b));
            return sb.toString(); // 32 chars uppercase hex
        } catch (Exception e) { return "00000000000000000000000000000000"; }
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

    private void logBle(String msg) {
        runOnUiThread(() -> {
            if (logBle == null) return;
            TextView v = tv(msg, 12, msg.startsWith("✓") ? COLOR_GREEN : msg.startsWith("✗") ? Color.rgb(185, 28, 28) : COLOR_MUTED, false);
            v.setPadding(0, dp(2), 0, dp(2));
            logBle.addView(v);
        });
    }

    private void toast(String msg) { Toast.makeText(this, msg, Toast.LENGTH_LONG).show(); }
}
