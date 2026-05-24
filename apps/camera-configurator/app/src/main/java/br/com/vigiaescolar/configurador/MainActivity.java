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
import android.widget.FrameLayout;
import android.widget.ProgressBar;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.text.InputType;
import android.view.Gravity;
import android.content.ContentValues;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.media.MediaPlayer;
import android.net.Uri;
import android.widget.MediaController;
import android.widget.VideoView;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.EditText;
import android.widget.ImageView;
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
 *  Notify Char:     00002b10-0000-1000-8000-00805f9b34fb  (câmera → app, registra notify)
 *  Write Char:      00002b11-0000-1000-8000-00805f9b34fb  (app → câmera, comandos)
 *  CCCD Descriptor: 00002902-0000-1000-8000-00805f9b34fb
 *
 *  CORREÇÃO (engenharia reversa e.n.d.c v7.1.1): o iCSee REGISTRA notify em 2b10
 *  (não 2b11 como assumimos antes) e ESCREVE em 2b11. Nosso log anterior mostrou
 *  2b11 com props=0x8 (WRITE) — confirma a inversão.
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
    // INVERTIDO em relação ao que assumimos antes (validado em e.n.d.c.a no iCSee dex)
    private static final UUID UUID_NOTIFY   = UUID.fromString("00002b10-0000-1000-8000-00805f9b34fb");
    private static final UUID UUID_WRITE    = UUID.fromString("00002b11-0000-1000-8000-00805f9b34fb");
    private static final UUID UUID_CCCD     = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb");

    // ─── FunID BLE ────────────────────────────────────────────────────────────
    // ─── Frame XM BLE (engenharia reversa de XMBleData + e.x.f no APK iCSee) ─
    //
    // Estrutura REAL do frame (descoberta via parseData no bytecode):
    //   [HEAD: 2 bytes = 0x8B 0x8B]
    //   [VERSION: 1 byte = 0x01]
    //   [CMD_ID:  1 byte = 0x01 SEND | 0x02 RECEIVE | 0x03 CALLBACK]
    //   [FUN_ID:  2 bytes big-endian = 0x0001 GET_NET_STATE | 0x0002 WIFI_BY_BLE | 0x0003 WIFI_BY_AP]
    //   [DATA_TYPE: 1 byte = 0x00 BIN_ENC | 0x01 STR_ENC | 0x02 BIN_NOENC]
    //   [CONTENT_LEN: 2 bytes big-endian]
    //   [CONTENT: N bytes]
    //   [CHECKSUM: 1 byte = soma de TODOS os bytes anteriores mod 256]
    //
    // Header é 0x8B 0x8B (não 0xAB como assumimos), FunId é 16-bit big-endian
    // (não 8-bit little-endian), e checksum é SOMA, não XOR.
    private static final byte BLE_HEAD_1    = (byte) 0x8B;
    private static final byte BLE_HEAD_2    = (byte) 0x8B;

    // CmdId
    private static final byte CMD_SEND      = 0x01;
    private static final byte CMD_RECEIVE   = 0x02;
    private static final byte CMD_CALLBACK  = 0x03;

    // FunId (16-bit big-endian no frame)
    private static final int FUN_GET_NETWORK_STATE   = 0x0001;
    private static final int FUN_CONNECT_WIFI_BY_BLE = 0x0002;
    private static final int FUN_CONNECT_WIFI_BY_AP  = 0x0003;

    // DataType
    private static final byte DT_BINARY_ENCRYPTION   = 0x00;
    private static final byte DT_STRING_ENCRYPTION   = 0x01;
    private static final byte DT_BINARY_NO_ENCRYPTION = 0x02;

    // ─── Protocolo DVRIP (fallback AP) ────────────────────────────────────────
    private static final String XM_AP_IP    = "192.168.10.1";
    private static final int    DVRIP_PORT  = 34567;
    private static final byte   DVRIP_MAGIC = (byte) 0xFF;
    private static final int    MSG_LOGIN   = 1000;
    private static final int    MSG_SET_CFG = 1040;
    private static final int    MSG_DEFAULT_CFG = 1042; // OPDefaultConfig — reset de fábrica
    private static final int    MSG_REBOOT  = 1450;     // OPMachine Reboot
    private static final int    DVRIP_OK    = 100;

    // ─── API VigiaEscolar ─────────────────────────────────────────────────────
    // URL pública oficial — sempre a mesma. Usuário leigo não precisa configurar.
    // Verificada via SSH na VPS (vigiaescolar.com.br/api/health retorna 200 com
    // service "vigiaescolar-api"). Nginx em /etc/nginx/sites-enabled/vigiaescolar
    // faz proxy_pass para 127.0.0.1:7003 (vigiaescolar-nginx-1) e dele para o
    // container vigiaescolar-api-1.
    private static final String API_BASE_URL = "https://vigiaescolar.com.br/api";
    // Host do servidor RTMP/MediaMTX para ingest do stream das câmeras
    // (firmware OpenIPC faz push para rtmp://<HOST>:1935/live/<serialNumber>).
    // Mesmo domínio da API — o nginx da VPS faz proxy para o container mediamtx.
    private static final String MEDIA_HOST = "vigiaescolar.com.br";
    private static final int    RTMP_PORT  = 1935;
    private static final int    RTSP_PORT  = 8554;
    private static final int[]  API_PORTS   = {3001, 7003, 80, 8080};   // legacy LAN discovery
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

    // ─── Wizard ───────────────────────────────────────────────────────────────
    // O app é estruturado como wizard: uma tela por vez, com botão "Avançar".
    // Páginas: 0=Boas-vindas, 1=Buscar câmera, 2=Selecionar rede WiFi,
    //          3=Senha WiFi, 4=Configurando (log), 5=Sucesso
    private static final int WIZ_WELCOME       = 0;
    private static final int WIZ_FIND_CAMERA   = 1;
    private static final int WIZ_PICK_WIFI     = 2;
    private static final int WIZ_WIFI_PASSWORD = 3;
    private static final int WIZ_CONFIGURING   = 4;
    private static final int WIZ_SUCCESS       = 5;
    private static final int WIZ_LOGIN         = 6;
    private static final int WIZ_REGISTER      = 7;
    private static final int WIZ_MY_CAMERAS    = 8;
    private FrameLayout wizardContainer;
    private View[]      wizardPages = new View[9];
    private int         currentStep = WIZ_WELCOME;
    private TextView    stepIndicator;
    private TextView    stepTitleHeader;

    // Estado do wizard
    private String      selectedCameraMac  = null;
    private String      selectedCameraName = null;
    private String      selectedWifiSsid   = null;
    private String      selectedWifiCaps   = null;  // capabilities da rede WiFi escolhida
    // IP descoberto na LAN após configuração — usado no payload de registerCamera
    private volatile String discoveredCameraIp = null;
    private volatile boolean ipDiscoveryRunning = false;

    // Câmeras configuradas (persistido em SharedPreferences "cameras")
    private LinearLayout myCamerasList;
    private final java.util.Map<String, Bitmap> snapshotCache = new java.util.HashMap<>();

    // ─── Widgets ──────────────────────────────────────────────────────────────
    private LinearLayout bleDeviceList;
    private LinearLayout wifiNetworkList;
    private LinearLayout networkList;
    private LinearLayout logBle;
    private LinearLayout apiList;
    private LinearLayout schoolList;

    private TextView     selectedCameraLabel;
    private TextView     selectedWifiLabel;
    private TextView     configStatusLabel;
    private ProgressBar  configProgress;
    private Button       wifiScanButton;
    private Button       wifiPasswordContinueBtn;

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
        // URL da API é hardcoded (API_BASE_URL) — não precisamos detectar.
        // O buildUi() já mostra WIZ_WELCOME por padrão. Sobrescrevemos:
        // - se há token salvo, valida em background; se ok, fica no Welcome
        // - se não há, mostra a tela de login como gate de entrada
        tryRestoreSessionOrGoToLogin();
    }

    @Override
    protected void onDestroy() {
        stopBleScan();
        disconnectBle();
        unregisterBondReceiver();
        pool.shutdownNow();
        if (dbHelper != null) { try { dbHelper.close(); } catch (Exception ignored) {} }
        super.onDestroy();
    }

    // ─── Construção da UI ─────────────────────────────────────────────────────

    @SuppressLint("SetTextI18n")
    private void buildUi() {
        // Container principal: header + indicador de passo + container do wizard + log
        LinearLayout root = vStack();
        root.setBackgroundColor(COLOR_BG);
        root.setLayoutParams(new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        // ── Header institucional ─────────────────────────────────────────────
        LinearLayout header = new LinearLayout(this);
        header.setOrientation(LinearLayout.VERTICAL);
        header.setPadding(dp(18), dp(14), dp(18), dp(14));
        header.setBackgroundColor(COLOR_BLUE);
        root.addView(header, new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        LinearLayout hRow = new LinearLayout(this);
        hRow.setOrientation(LinearLayout.HORIZONTAL);
        hRow.setGravity(Gravity.CENTER_VERTICAL);
        View dot = new View(this);
        dot.setBackground(rounded(COLOR_GREEN, COLOR_GREEN, 6));
        hRow.addView(dot, new LinearLayout.LayoutParams(dp(10), dp(10)));
        TextView hTitle = tv("VigiaEscolar", 18, Color.WHITE, true);
        hTitle.setPadding(dp(10), 0, 0, 0);
        hRow.addView(hTitle);
        header.addView(hRow);

        stepTitleHeader = tv("", 13, Color.argb(220, 255, 255, 255), false);
        stepTitleHeader.setPadding(0, dp(2), 0, 0);
        header.addView(stepTitleHeader);

        // ── Indicador de progresso (Passo N de M) ────────────────────────────
        LinearLayout indicatorBar = new LinearLayout(this);
        indicatorBar.setOrientation(LinearLayout.HORIZONTAL);
        indicatorBar.setPadding(dp(18), dp(10), dp(18), dp(10));
        indicatorBar.setBackgroundColor(Color.WHITE);
        indicatorBar.setGravity(Gravity.CENTER_VERTICAL);
        stepIndicator = tv("Passo 1 de 5", 12, COLOR_BLUE, true);
        indicatorBar.addView(stepIndicator);
        root.addView(indicatorBar, new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        View divider = new View(this);
        divider.setBackgroundColor(COLOR_BORDER);
        root.addView(divider, new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, dp(1)));

        // ── Container do wizard (frame com 6 páginas, só uma visível) ───────
        wizardContainer = new FrameLayout(this);
        wizardContainer.setLayoutParams(new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        root.addView(wizardContainer);

        wizardPages[WIZ_WELCOME]       = buildPageWelcome();
        wizardPages[WIZ_FIND_CAMERA]   = buildPageFindCamera();
        wizardPages[WIZ_PICK_WIFI]     = buildPagePickWifi();
        wizardPages[WIZ_WIFI_PASSWORD] = buildPageWifiPassword();
        wizardPages[WIZ_CONFIGURING]   = buildPageConfiguring();
        wizardPages[WIZ_SUCCESS]       = buildPageSuccess();
        wizardPages[WIZ_LOGIN]         = buildPageLogin();
        wizardPages[WIZ_REGISTER]      = buildPageRegister();
        wizardPages[WIZ_MY_CAMERAS]    = buildPageMyCameras();
        for (View page : wizardPages) wizardContainer.addView(page);

        // Inicializa também widgets/campos do fluxo legado (modo AP, API, registro)
        // — escondidos mas mantêm o código existente funcionando
        initLegacyWidgets();

        setContentView(root);
        showStep(WIZ_WELCOME);
    }

    // ── Wizard helpers ────────────────────────────────────────────────────────

    private void showStep(int step) {
        if (step < 0 || step >= wizardPages.length) return;
        currentStep = step;
        for (int i = 0; i < wizardPages.length; i++) {
            wizardPages[i].setVisibility(i == step ? View.VISIBLE : View.GONE);
        }
        if (step == WIZ_WELCOME) {
            stepIndicator.setText("Bem-vindo");
            stepTitleHeader.setText("Configurador de Câmera");
        } else if (step == WIZ_SUCCESS) {
            stepIndicator.setText("Wi-Fi configurado");
            stepTitleHeader.setText("Câmera no Wi-Fi");
        } else if (step == WIZ_LOGIN) {
            // Quando ainda não há sessão é o gate de entrada do app; senão é um passo do wizard
            boolean hasSession = apiToken != null && !apiToken.isEmpty();
            stepIndicator.setText(hasSession ? "Passo 6 de 7" : "Acesso ao VigiaEscolar");
            stepTitleHeader.setText("Entrar no VigiaEscolar");
        } else if (step == WIZ_REGISTER) {
            stepIndicator.setText("Passo 7 de 7");
            stepTitleHeader.setText("Cadastrar câmera");
        } else if (step == WIZ_MY_CAMERAS) {
            stepIndicator.setText("Minhas câmeras");
            stepTitleHeader.setText("Câmeras configuradas");
        } else {
            stepIndicator.setText("Passo " + step + " de 7");
            String[] titles = {"", "Encontrar câmera", "Escolher rede WiFi",
                "Senha da rede", "Enviando configuração"};
            stepTitleHeader.setText(titles[step]);
        }
    }

    private LinearLayout wizardPage() {
        LinearLayout page = vStack();
        page.setPadding(dp(18), dp(20), dp(18), dp(20));
        page.setLayoutParams(new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        return page;
    }

    private ScrollView wizardScrollPage(LinearLayout inner) {
        ScrollView sv = new ScrollView(this);
        sv.setFillViewport(true);
        sv.setLayoutParams(new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        sv.addView(inner, new ScrollView.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        return sv;
    }

    private TextView wizardHeading(String text) {
        TextView t = tv(text, 22, COLOR_BLUE, true);
        t.setPadding(0, 0, 0, dp(8));
        return t;
    }

    // ── Página 0: Boas-vindas ─────────────────────────────────────────────────
    private View buildPageWelcome() {
        LinearLayout page = wizardPage();
        page.setGravity(Gravity.CENTER);

        TextView title = tv("Configurador de Câmera", 24, COLOR_BLUE, true);
        title.setGravity(Gravity.CENTER);
        page.addView(title);

        TextView desc = muted(
            "Configure câmeras XM/iCSee no Wi-Fi da escola em poucos passos.\n\n" +
            "Antes de começar:\n" +
            "• Energize a câmera e aguarde o LED piscar (modo de pareamento)\n" +
            "• Ative o Bluetooth e a Localização do celular\n" +
            "• Conecte o celular na rede Wi-Fi da escola"
        );
        desc.setGravity(Gravity.CENTER);
        desc.setPadding(0, dp(16), 0, dp(28));
        page.addView(desc);

        page.addView(primaryBtn("Configurar nova câmera", v -> {
            showStep(WIZ_FIND_CAMERA);
            startBleScan();
        }));

        page.addView(gap(secondaryBtn("Minhas câmeras configuradas", v -> {
            showStep(WIZ_MY_CAMERAS);
            renderMyCameras();
        }), dp(10)));

        // Botão Sair discreto
        Button signOutBtn = new Button(this);
        signOutBtn.setText("Sair");
        signOutBtn.setAllCaps(false);
        signOutBtn.setTextColor(COLOR_MUTED);
        signOutBtn.setBackgroundColor(Color.TRANSPARENT);
        signOutBtn.setTextSize(13);
        signOutBtn.setOnClickListener(v -> {
            new android.app.AlertDialog.Builder(this)
                .setTitle("Sair do VigiaEscolar?")
                .setMessage("Você precisará entrar novamente com seu e-mail e senha.")
                .setPositiveButton("Sair", (d, w) -> signOutAndGoToLogin())
                .setNegativeButton("Cancelar", null)
                .show();
        });
        page.addView(gap(signOutBtn, dp(40)));

        return page;
    }

    // ── Página 1: Encontrar câmera ────────────────────────────────────────────
    private View buildPageFindCamera() {
        LinearLayout page = wizardPage();

        page.addView(wizardHeading("Encontrar câmera"));
        page.addView(muted("Coloque a câmera em modo de pareamento (LED piscando) e toque em \"Procurar\". Toque na câmera que aparecer para selecioná-la."));

        bleScanButton = secondaryBtn("Procurar câmeras", v -> toggleBleScan());
        page.addView(gap(bleScanButton, dp(14)));

        statusBle = statusChip("Aguardando...");
        page.addView(gap(statusBle, dp(8)));

        TextView listLbl = tv("Câmeras encontradas:", 13, COLOR_TEXT, true);
        page.addView(gap(listLbl, dp(14)));

        bleDeviceList = vStack();
        page.addView(gap(bleDeviceList, dp(4)));

        // Aviso: câmera só aparece em modo de pareamento
        LinearLayout warnBox = new LinearLayout(this);
        warnBox.setOrientation(LinearLayout.VERTICAL);
        warnBox.setPadding(dp(12), dp(10), dp(12), dp(10));
        warnBox.setBackground(rounded(COLOR_WARN_BG, COLOR_WARN_BDR, 10));
        warnBox.setLayoutParams(matchWrap(0, dp(20), 0, 0));
        TextView wt = tv("Não aparece nada?", 13, Color.rgb(120, 53, 15), true);
        warnBox.addView(wt);
        TextView wd = tv(
            "Câmeras XM só aparecem no Bluetooth durante o modo de pareamento (LED piscando rápido).\n\n" +
            "Se a câmera já foi configurada antes, faça um RESET: segure o botão de reset por 5 a 10 segundos até o LED voltar a piscar.",
            12, Color.rgb(120, 53, 15), false);
        wd.setPadding(0, dp(4), 0, 0);
        warnBox.addView(wd);
        page.addView(warnBox);

        return wizardScrollPage(page);
    }

    // ── Página 2: Escolher rede WiFi ──────────────────────────────────────────
    private View buildPagePickWifi() {
        LinearLayout page = wizardPage();

        page.addView(wizardHeading("Escolher rede Wi-Fi"));

        selectedCameraLabel = tv("", 12, COLOR_GREEN, true);
        page.addView(selectedCameraLabel);

        page.addView(muted("Escolha a rede Wi-Fi que a câmera vai usar. Deve ser a rede da escola, não a do celular se for diferente."));

        wifiScanButton = secondaryBtn("Atualizar lista de redes", v -> scanWifiNetworks());
        page.addView(gap(wifiScanButton, dp(14)));

        TextView listLbl = tv("Redes disponíveis (2,4 GHz):", 13, COLOR_TEXT, true);
        page.addView(gap(listLbl, dp(14)));

        wifiNetworkList = vStack();
        page.addView(gap(wifiNetworkList, dp(4)));

        // Opção: digitar manualmente
        page.addView(gap(tv("Não encontrou a rede?", 12, COLOR_MUTED, false), dp(14)));
        Button manualBtn = secondaryBtn("Digitar nome da rede manualmente", v -> showManualSsidDialog());
        page.addView(gap(manualBtn, dp(6)));

        return wizardScrollPage(page);
    }

    // ── Página 3: Senha da rede ───────────────────────────────────────────────
    private View buildPageWifiPassword() {
        LinearLayout page = wizardPage();

        page.addView(wizardHeading("Senha do Wi-Fi"));
        selectedWifiLabel = tv("", 14, COLOR_BLUE, true);
        selectedWifiLabel.setPadding(0, 0, 0, dp(10));
        page.addView(selectedWifiLabel);

        page.addView(muted("Digite a senha da rede Wi-Fi. Se a rede for aberta (sem senha), deixe em branco."));

        wifiPassInput = inputPass("Senha da rede Wi-Fi");
        page.addView(gap(field("Senha", wifiPassInput), dp(8)));

        page.addView(gap(tv("Avançado: senha da câmera (deixe em branco se nunca configurou):", 11, COLOR_MUTED, false), dp(16)));
        cameraPassInput = inputPass("Senha da câmera (opcional)");
        page.addView(gap(field("Senha da câmera", cameraPassInput), dp(4)));

        // Botões: Voltar / Continuar
        LinearLayout btnRow = new LinearLayout(this);
        btnRow.setOrientation(LinearLayout.HORIZONTAL);
        btnRow.setLayoutParams(matchWrap(0, dp(22), 0, 0));

        Button backBtn = secondaryBtn("Voltar", v -> showStep(WIZ_PICK_WIFI));
        LinearLayout.LayoutParams bp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        bp.rightMargin = dp(6);
        backBtn.setLayoutParams(bp);
        btnRow.addView(backBtn);

        wifiPasswordContinueBtn = primaryBtn("Configurar câmera", v -> startConfiguration());
        LinearLayout.LayoutParams cp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        cp.leftMargin = dp(6);
        wifiPasswordContinueBtn.setLayoutParams(cp);
        btnRow.addView(wifiPasswordContinueBtn);

        page.addView(btnRow);

        return wizardScrollPage(page);
    }

    // ── Página 4: Configurando (log + status) ─────────────────────────────────
    private View buildPageConfiguring() {
        LinearLayout page = wizardPage();

        page.addView(wizardHeading("Enviando configuração"));

        configProgress = new ProgressBar(this);
        LinearLayout.LayoutParams ppp = matchWrap(0, dp(8), 0, dp(8));
        configProgress.setLayoutParams(ppp);
        page.addView(configProgress);

        configStatusLabel = tv("Conectando à câmera...", 14, COLOR_TEXT, false);
        page.addView(gap(configStatusLabel, dp(6)));

        page.addView(muted("Não feche o app. A câmera vai receber o Wi-Fi via Bluetooth, e em seguida vai conectar à rede e acender o LED fixo (5–20 segundos)."));

        // Painel de log
        LinearLayout logHeader = new LinearLayout(this);
        logHeader.setOrientation(LinearLayout.HORIZONTAL);
        logHeader.setGravity(Gravity.CENTER_VERTICAL);
        logHeader.setLayoutParams(matchWrap(0, dp(20), 0, dp(4)));

        TextView logTitle = tv("Log de diagnóstico", 11, COLOR_MUTED, true);
        logTitle.setLayoutParams(new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        logHeader.addView(logTitle);

        Button copyBtn = new Button(this);
        copyBtn.setText("Copiar");
        copyBtn.setAllCaps(false);
        copyBtn.setTextSize(11);
        copyBtn.setTextColor(COLOR_BLUE_MED);
        copyBtn.setTypeface(Typeface.DEFAULT_BOLD);
        copyBtn.setPadding(dp(10), dp(4), dp(10), dp(4));
        copyBtn.setBackground(rounded(Color.rgb(219, 234, 254), Color.rgb(147, 197, 253), 8));
        copyBtn.setOnClickListener(v -> copyLogsToClipboard());
        logHeader.addView(copyBtn);

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

        page.addView(logHeader);

        logScrollView = new ScrollView(this);
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
        page.addView(logScrollView);

        Button cancelBtn = secondaryBtn("Cancelar e voltar", v -> {
            disconnectBle();
            showStep(WIZ_WELCOME);
        });
        page.addView(gap(cancelBtn, dp(16)));

        return wizardScrollPage(page);
    }

    // ── Página 5: Sucesso (Wi-Fi enviado) ─────────────────────────────────────
    private View buildPageSuccess() {
        LinearLayout page = wizardPage();
        page.setGravity(Gravity.CENTER_HORIZONTAL);

        TextView icon = tv("✓", 64, COLOR_GREEN, true);
        icon.setGravity(Gravity.CENTER);
        icon.setPadding(0, dp(20), 0, 0);
        page.addView(icon);

        TextView title = tv("Wi-Fi enviado!", 22, COLOR_BLUE, true);
        title.setGravity(Gravity.CENTER);
        title.setPadding(0, dp(8), 0, dp(8));
        page.addView(title);

        TextView desc = muted(
            "A câmera está conectando à rede Wi-Fi da escola.\n" +
            "Aguarde alguns instantes até o LED ficar fixo.\n\n" +
            "Próximo passo: cadastrar a câmera no painel VigiaEscolar " +
            "para que ela apareça no monitoramento."
        );
        desc.setGravity(Gravity.CENTER);
        desc.setPadding(0, 0, 0, dp(28));
        page.addView(desc);

        page.addView(gap(primaryBtn("Cadastrar no VigiaEscolar", v -> {
            // Vai para login se ainda não autenticou, senão direto pro cadastro
            if (apiToken == null || apiToken.isEmpty()) {
                openLoginPage();
            } else {
                showStep(WIZ_REGISTER);
            }
        }), dp(8)));

        page.addView(gap(secondaryBtn("Configurar outra câmera", v -> {
            resetWizardState();
            showStep(WIZ_WELCOME);
        }), dp(10)));

        return page;
    }

    // ── Página 6: Login VigiaEscolar ──────────────────────────────────────────
    private Button loginEntrarBtn;
    private Button loginBackBtn;

    private View buildPageLogin() {
        LinearLayout page = wizardPage();

        page.addView(wizardHeading("Entrar no VigiaEscolar"));
        page.addView(muted("Use o mesmo e-mail e senha do painel web vigiaescolar.com.br."));

        // URL fixa — usuário não vê nem precisa configurar
        apiUrlInput = input("");
        apiUrlInput.setText(API_BASE_URL);

        emailInput = inputEmail("seu@email.com");
        appPasswordInput = inputPass("Sua senha");

        // Pré-preenche e-mail salvo
        android.content.SharedPreferences prefs = getSharedPreferences("vigiaescolar", MODE_PRIVATE);
        emailInput.setText(prefs.getString("api_email", ""));

        page.addView(gap(field("E-mail", emailInput), dp(14)));
        page.addView(field("Senha", appPasswordInput));

        // Widgets escondidos — preservam referências usadas por loginApi()/showSchools()
        statusApi = statusChip("Não conectado");
        statusApi.setVisibility(View.GONE);
        page.addView(statusApi);
        apiList = vStack();
        apiList.setVisibility(View.GONE);
        page.addView(apiList);

        // Botões: Voltar / Entrar
        LinearLayout btnRow = new LinearLayout(this);
        btnRow.setOrientation(LinearLayout.HORIZONTAL);
        btnRow.setLayoutParams(matchWrap(0, dp(22), 0, 0));

        loginBackBtn = secondaryBtn("Voltar", v -> showStep(WIZ_SUCCESS));
        LinearLayout.LayoutParams bp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        bp.rightMargin = dp(6);
        loginBackBtn.setLayoutParams(bp);
        btnRow.addView(loginBackBtn);

        loginEntrarBtn = primaryBtn("Entrar", v -> {
            String email = emailInput.getText().toString().trim();
            String pass  = appPasswordInput.getText().toString().trim();
            if (email.isEmpty() || pass.isEmpty()) { toast("Preencha e-mail e senha"); return; }
            // Garante que a URL hardcoded está no input antes do loginApi()
            apiUrlInput.setText(API_BASE_URL);
            // Salva e-mail (não a senha)
            getSharedPreferences("vigiaescolar", MODE_PRIVATE).edit()
                .putString("api_url", API_BASE_URL)
                .putString("api_email", email)
                .apply();
            loginApiAndAdvance();
        });
        LinearLayout.LayoutParams cp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        cp.leftMargin = dp(6);
        loginEntrarBtn.setLayoutParams(cp);
        btnRow.addView(loginEntrarBtn);

        page.addView(btnRow);

        // Rodapé com link discreto para o site
        TextView footer = tv("vigiaescolar.com.br", 11, COLOR_MUTED, false);
        footer.setGravity(Gravity.CENTER);
        footer.setPadding(0, dp(20), 0, 0);
        page.addView(footer);

        return wizardScrollPage(page);
    }

    private EditText inputEmail(String hint) {
        EditText e = input(hint);
        e.setInputType(android.text.InputType.TYPE_CLASS_TEXT
            | android.text.InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS);
        return e;
    }

    /** No-op preservado para os call-sites antigos do código de detecção dinâmica. */
    /** No-op preservado para os call-sites antigos. URL é hardcoded agora. */
    @SuppressWarnings("unused")
    private void updateLoginApiStatus(String text, int color, boolean enableLogin) {
        if (loginEntrarBtn != null) {
            loginEntrarBtn.setEnabled(enableLogin);
            loginEntrarBtn.setAlpha(enableLogin ? 1f : 0.5f);
        }
    }

    // ── Página 7: Cadastrar câmera ────────────────────────────────────────────
    private View buildPageRegister() {
        LinearLayout page = wizardPage();

        page.addView(wizardHeading("Cadastrar câmera"));
        page.addView(muted("Dê um nome e localização para identificar a câmera no painel."));

        // Selecionar escola
        TextView schoolLbl = tv("Escola onde a câmera está instalada:", 13, COLOR_TEXT, true);
        schoolLbl.setPadding(0, dp(14), 0, dp(6));
        page.addView(schoolLbl);

        schoolList = vStack();
        page.addView(schoolList);

        cameraNameInput = input("Ex: Pátio Central");
        cameraNameInput.setText("Câmera XM");
        cameraLocInput  = input("Ex: Sala 12, Portão Norte");
        page.addView(gap(field("Nome da câmera", cameraNameInput), dp(14)));
        page.addView(field("Localização", cameraLocInput));

        page.addView(gap(muted("O IP será detectado automaticamente quando a câmera estiver conectada ao Wi-Fi. Caso ainda não tenha aparecido, o cadastro será feito sem IP e atualizado depois."), dp(14)));

        // Botões: Voltar / Cadastrar
        LinearLayout btnRow = new LinearLayout(this);
        btnRow.setOrientation(LinearLayout.HORIZONTAL);
        btnRow.setLayoutParams(matchWrap(0, dp(20), 0, 0));

        Button backBtn = secondaryBtn("Voltar", v -> showStep(WIZ_SUCCESS));
        LinearLayout.LayoutParams bp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        bp.rightMargin = dp(6);
        backBtn.setLayoutParams(bp);
        btnRow.addView(backBtn);

        Button regBtn = primaryBtn("Cadastrar câmera", v -> registerCameraFromWizard());
        LinearLayout.LayoutParams cp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        cp.leftMargin = dp(6);
        regBtn.setLayoutParams(cp);
        btnRow.addView(regBtn);

        page.addView(btnRow);

        return wizardScrollPage(page);
    }

    private void loginApiAndAdvance() {
        // loginApi() já mostra status e chama fetchSchools no sucesso.
        // Aqui adicionamos o avanço de tela quando o login termina OK.
        loginApi();
        // Polling simples: aguarda apiToken aparecer (até 12s)
        final int[] waits = {0};
        Runnable poll = new Runnable() {
            @Override public void run() {
                if (apiToken != null && !apiToken.isEmpty()) {
                    // Se há câmera em meio ao fluxo de configuração, vai para Register.
                    // Senão, login foi pelo gate inicial — vai para Welcome.
                    if (selectedCameraMac != null && !selectedCameraMac.isEmpty()) {
                        showStep(WIZ_REGISTER);
                    } else {
                        showStep(WIZ_WELCOME);
                    }
                    return;
                }
                if (++waits[0] < 24) mainHandler.postDelayed(this, 500);
            }
        };
        mainHandler.postDelayed(poll, 500);
    }

    private void registerCameraFromWizard() {
        if (apiToken == null || apiToken.isEmpty()) {
            toast("Faça login primeiro");
            openLoginPage();
            return;
        }
        if (selectedSchoolId == null || selectedSchoolId.isEmpty()) {
            toast("Selecione a escola");
            return;
        }
        if (cameraNameInput.getText().toString().trim().isEmpty()) {
            toast("Informe o nome da câmera");
            return;
        }
        registerCamera();
        // Após enviar, aguarda 1.5s e volta pra welcome (toast informa sucesso/erro)
        mainHandler.postDelayed(() -> {
            resetWizardState();
            showStep(WIZ_WELCOME);
        }, 1800);
    }

    // ── Página 8: Minhas câmeras (persistidas localmente + sincronizadas) ────
    private View buildPageMyCameras() {
        LinearLayout page = wizardPage();

        page.addView(wizardHeading("Minhas câmeras"));
        page.addView(muted("Câmeras já configuradas. A lista é sincronizada com o servidor VigiaEscolar para sobreviver à reinstalação do app."));

        page.addView(gap(secondaryBtn("Sincronizar com servidor", v -> syncCamerasFromServer(true)), dp(12)));

        myCamerasList = vStack();
        page.addView(gap(myCamerasList, dp(14)));

        page.addView(gap(secondaryBtn("Voltar ao início", v -> showStep(WIZ_WELCOME)), dp(20)));

        return wizardScrollPage(page);
    }

    /**
     * Baixa lista de câmeras do servidor VigiaEscolar (GET /cameras) e popula
     * o banco SQLite local. Chamado:
     *   - após login bem-sucedido (silencioso)
     *   - quando o usuário toca em "Sincronizar com servidor"
     *
     * Cada câmera remota é identificada pelo bluetoothMac. Se já existir
     * localmente, mantém o snapshot e atualiza os demais campos. Se não
     * existir, insere. Não apaga câmeras locais que não estão no servidor
     * (podem estar em meio à configuração ou serem de outro tenant).
     */
    private void syncCamerasFromServer(boolean showToasts) {
        if (apiToken == null || apiToken.isEmpty()) {
            if (showToasts) toast("Faça login primeiro");
            return;
        }
        final String url = apiUrlInput != null
            ? apiUrlInput.getText().toString().trim().replaceAll("/$", "")
            : "";
        if (url.isEmpty()) {
            if (showToasts) toast("Servidor não configurado");
            return;
        }
        pool.execute(() -> {
            try {
                HttpURLConnection c = (HttpURLConnection) new URL(url + "/cameras").openConnection();
                c.setRequestMethod("GET");
                c.setRequestProperty("Authorization", "Bearer " + apiToken);
                c.setRequestProperty("Accept", "application/json");
                c.setConnectTimeout(6000); c.setReadTimeout(8000);
                int code = c.getResponseCode();
                if (code >= 300) throw new Exception("HTTP " + code);
                String raw = readStream(c.getInputStream()).trim();
                JSONArray arr = raw.startsWith("[") ? new JSONArray(raw)
                    : new JSONObject(raw).optJSONArray("data");
                if (arr == null) arr = new JSONArray();

                int merged = 0;
                for (int i = 0; i < arr.length(); i++) {
                    JSONObject cam = arr.optJSONObject(i);
                    if (cam == null) continue;
                    String mac = cam.optString("bluetoothMac", "");
                    if (mac.isEmpty()) continue;  // câmera sem MAC não foi configurada pelo APK
                    upsertCameraFromServer(cam);
                    merged++;
                }

                final int finalMerged = merged;
                runOnUiThread(() -> {
                    if (showToasts) toast("✓ Sincronizadas " + finalMerged + " câmeras do servidor");
                    if (currentStep == WIZ_MY_CAMERAS) renderMyCameras();
                });
            } catch (Exception e) {
                if (showToasts) runOnUiThread(() -> toast("Erro ao sincronizar: " + e.getMessage()));
            }
        });
    }

    /** Insere ou atualiza uma câmera vinda da API, preservando snapshot local. */
    private void upsertCameraFromServer(JSONObject remote) {
        String mac = remote.optString("bluetoothMac", "");
        if (mac.isEmpty()) return;
        try {
            JSONObject existing = findCamera(mac);
            ContentValues cv = new ContentValues();
            cv.put("mac",  mac);
            cv.put("name", remote.optString("nome", "Câmera"));
            cv.put("ssid", remote.optString("wifiSsid", ""));
            cv.put("sn",   remote.optString("serialNumber", ""));
            // IP: extrai do streamUrl (rtsp://IP:554/...) se possível
            String streamUrl = remote.optString("url", "");
            String ip = extractIpFromStreamUrl(streamUrl);
            cv.put("ip", existing != null && (ip == null || ip.isEmpty())
                ? existing.optString("ip", "") : (ip == null ? "" : ip));
            cv.put("configured_at", existing != null
                ? existing.optLong("when", System.currentTimeMillis())
                : System.currentTimeMillis());
            db().getWritableDatabase()
                .insertWithOnConflict(CamerasDb.TABLE, null, cv, SQLiteDatabase.CONFLICT_REPLACE);
        } catch (Exception ignored) {}
    }

    private String extractIpFromStreamUrl(String url) {
        if (url == null || url.isEmpty()) return "";
        try {
            int proto = url.indexOf("://");
            if (proto < 0) return "";
            String rest = url.substring(proto + 3);
            int slash = rest.indexOf('/');
            String hostPort = slash >= 0 ? rest.substring(0, slash) : rest;
            int colon = hostPort.indexOf(':');
            String host = colon >= 0 ? hostPort.substring(0, colon) : hostPort;
            // Verifica se parece IPv4 (não vamos resolver DNS)
            if (host.matches("\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}")) return host;
        } catch (Exception ignored) {}
        return "";
    }

    private void renderMyCameras() {
        if (myCamerasList == null) return;
        myCamerasList.removeAllViews();
        JSONArray cams = loadSavedCameras();
        if (cams.length() == 0) {
            myCamerasList.addView(muted("Nenhuma câmera configurada ainda. Use \"Configurar nova câmera\" para começar."));
            return;
        }
        for (int i = 0; i < cams.length(); i++) {
            JSONObject c = cams.optJSONObject(i);
            if (c != null) myCamerasList.addView(buildCameraCard(c));
        }
    }

    private View buildCameraCard(JSONObject cam) {
        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(dp(14), dp(14), dp(14), dp(14));
        card.setBackground(rounded(COLOR_CARD, COLOR_BORDER, 12));
        card.setLayoutParams(matchWrap(0, 0, 0, dp(12)));

        String name = cam.optString("name", cam.optString("ssid", "Câmera"));
        String ssid = cam.optString("ssid", "");
        String mac  = cam.optString("mac", "");
        String sn   = cam.optString("sn", "");
        String ip   = cam.optString("ip", "");
        long   when = cam.optLong("when", 0L);

        TextView tName = tv(name, 16, COLOR_BLUE, true);
        card.addView(tName);

        TextView tInfo = tv(
            (ssid.isEmpty() ? "" : "Wi-Fi: " + ssid + "\n") +
            (mac.isEmpty()  ? "" : "MAC: " + mac + "\n") +
            (sn.isEmpty()   ? "" : "SN: " + sn + "\n") +
            (ip.isEmpty()   ? "IP: ainda não detectado" : "IP: " + ip) +
            (when > 0 ? "\nConfigurada em: " + formatDate(when) : ""),
            11, COLOR_MUTED, false);
        tInfo.setPadding(0, dp(4), 0, dp(10));
        card.addView(tInfo);

        // Miniatura (snapshot)
        ImageView thumb = new ImageView(this);
        thumb.setBackgroundColor(Color.rgb(15, 23, 42));
        thumb.setScaleType(ImageView.ScaleType.CENTER_CROP);
        LinearLayout.LayoutParams tp = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, dp(180));
        tp.topMargin = dp(4);
        thumb.setLayoutParams(tp);
        // Placeholder texto via fundo escuro + ícone
        TextView placeholder = tv("📷 sem miniatura — toque em \"Atualizar miniatura\"", 11, Color.argb(150, 255, 255, 255), false);
        placeholder.setGravity(Gravity.CENTER);
        FrameLayout thumbWrap = new FrameLayout(this);
        thumbWrap.setLayoutParams(tp);
        thumbWrap.addView(thumb, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        thumbWrap.addView(placeholder, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.CENTER));
        card.addView(thumbWrap);

        Bitmap cached = snapshotCache.get(mac);
        if (cached == null) {
            // Tenta carregar do banco SQLite (snapshot BLOB persistido)
            cached = loadSnapshotFromDisk(mac);
            if (cached != null) snapshotCache.put(mac, cached);
        }
        if (cached != null) {
            thumb.setImageBitmap(cached);
            placeholder.setVisibility(View.GONE);
        }

        // Linha de botões
        LinearLayout btnRow = new LinearLayout(this);
        btnRow.setOrientation(LinearLayout.HORIZONTAL);
        btnRow.setLayoutParams(matchWrap(0, dp(12), 0, 0));

        Button refreshBtn = secondaryBtn("Atualizar miniatura", v -> {
            placeholder.setVisibility(View.VISIBLE);
            placeholder.setText("⏳ buscando câmera na rede...");
            fetchSnapshotAsync(cam, thumb, placeholder);
        });
        LinearLayout.LayoutParams bp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        bp.rightMargin = dp(6);
        refreshBtn.setLayoutParams(bp);
        btnRow.addView(refreshBtn);

        Button delBtn = secondaryBtn("Remover", v -> showRemoveDialog(cam));
        LinearLayout.LayoutParams dpp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        dpp.leftMargin = dp(6);
        delBtn.setLayoutParams(dpp);
        btnRow.addView(delBtn);

        card.addView(btnRow);

        // Botão de diagnóstico técnico — leitura SEGURA da câmera via DVRIP.
        // Usado para confirmar SoC/hardware antes do upgrade OpenIPC.
        Button diagBtn = new Button(this);
        diagBtn.setText("🔧 Diagnóstico técnico (Etapa 1)");
        diagBtn.setAllCaps(false);
        diagBtn.setTextSize(12);
        diagBtn.setTextColor(COLOR_BLUE_MED);
        diagBtn.setBackground(rounded(Color.rgb(219, 234, 254), Color.rgb(147, 197, 253), 8));
        diagBtn.setPadding(dp(10), dp(8), dp(10), dp(8));
        LinearLayout.LayoutParams diagParams = matchWrap(0, dp(8), 0, 0);
        diagBtn.setLayoutParams(diagParams);
        diagBtn.setOnClickListener(v -> runDiagnosticOnCamera(cam));
        card.addView(diagBtn);

        return card;
    }

    /**
     * Etapa 1 do roadmap OpenIPC: chama dvripDiagnostic e mostra resultado num
     * dialog rolável + botão "Copiar relatório" para o usuário enviar para
     * análise. NÃO escreve nada na câmera — só lê info.
     */
    private void runDiagnosticOnCamera(final JSONObject cam) {
        final String name = cam.optString("name", "Câmera");
        final String mac  = cam.optString("mac", "");
        final String sn   = cam.optString("sn", "");
        final String savedIp = cam.optString("ip", "");
        final String camPass = cameraPassInput != null ? cameraPassInput.getText().toString().trim() : "";

        // Container do dialog
        final android.app.AlertDialog.Builder b = new android.app.AlertDialog.Builder(this);
        b.setTitle("Diagnóstico — " + name);

        final ScrollView sv = new ScrollView(this);
        final TextView tv = new TextView(this);
        tv.setText("⏳ Procurando câmera na rede e coletando informações...\n\nEsse processo leva 5-30 segundos.");
        tv.setTextSize(11);
        tv.setTypeface(android.graphics.Typeface.MONOSPACE);
        tv.setPadding(dp(16), dp(12), dp(16), dp(12));
        tv.setTextIsSelectable(true);
        sv.addView(tv);
        b.setView(sv);

        b.setPositiveButton("Copiar relatório", (d, w) -> {
            android.content.ClipboardManager cm = (android.content.ClipboardManager)
                getSystemService(Context.CLIPBOARD_SERVICE);
            if (cm != null) {
                cm.setPrimaryClip(android.content.ClipData.newPlainText(
                    "Diagnóstico " + name, tv.getText().toString()));
                toast("Relatório copiado");
            }
        });
        b.setNegativeButton("Fechar", null);
        final android.app.AlertDialog dialog = b.create();
        dialog.show();

        // Diagnóstico em background
        pool.execute(() -> {
            StringBuilder pre = new StringBuilder();
            pre.append("=== BUSCA INICIAL ===\n");
            String myIp = wifiIp();
            pre.append("Meu IP (celular no Wi-Fi): ").append(myIp != null ? myIp : "(não detectado)").append("\n");
            pre.append("IP salvo no banco: ").append(savedIp.isEmpty() ? "(vazio)" : savedIp).append("\n");

            String ip = savedIp;

            // Se IP salvo existe, valida que a porta DVRIP responde antes de confiar nele
            if (ip != null && !ip.isEmpty()) {
                pre.append("Testando IP salvo...\n");
                boolean savedOk = isOpen(ip, DVRIP_PORT, 1500);
                pre.append("Porta 34567 em ").append(ip).append(": ").append(savedOk ? "ABERTA" : "FECHADA").append("\n");
                if (!savedOk) {
                    pre.append("IP salvo não responde — ignorando e varrendo subnet...\n");
                    ip = "";
                }
            }

            if (ip == null || ip.isEmpty()) {
                pre.append("Varrendo subnet local (porta 34567)...\n");
                ip = findCameraIpOnLan(sn, mac);
                pre.append("Resultado: ").append(ip == null ? "(não encontrou)" : ip).append("\n");
            }

            pre.append("=== FIM BUSCA ===\n\n");

            if (ip == null || ip.isEmpty()) {
                final String prefinal = pre.toString();
                runOnUiThread(() -> tv.setText(prefinal +
                    "✗ Câmera não encontrada na rede.\n\n" +
                    "Verifique que:\n" +
                    "1. O celular está conectado no MESMO Wi-Fi que a câmera\n" +
                    "2. A câmera está ligada e com LED fixo (conectada)\n" +
                    "3. A rede permite descoberta entre dispositivos\n" +
                    "4. O AP/roteador não tem isolamento de clientes (\"AP isolation\")\n\n" +
                    "MAC esperado: " + mac + "\n" +
                    "SN esperado: " + sn));
                return;
            }
            final String finalIp = ip;
            final String prefinal = pre.toString();
            runOnUiThread(() -> tv.setText(prefinal + "⏳ Câmera em " + finalIp + ", conectando DVRIP..."));

            // Atualiza o IP no DB se mudou
            if (!finalIp.equals(savedIp) && mac != null && !mac.isEmpty()) {
                updateSavedCameraIp(mac, finalIp);
            }

            // Tenta admin sem senha primeiro (padrão XM); se falhar, tenta com senha do wizard
            String[] credentials = camPass.isEmpty()
                ? new String[]{"admin", ""}
                : new String[]{"admin", camPass, "admin", ""};
            String report = null;
            for (int i = 0; i < credentials.length; i += 2) {
                String user = credentials[i];
                String pass = credentials[i + 1];
                String r = dvripDiagnostic(finalIp, user, pass);
                if (r.contains("[1] LOGIN") && !r.contains("✗ Login falhou")) {
                    report = r;
                    break;
                }
                report = r;  // mantém o último (pra mostrar erro de login se todos falharem)
            }
            final String finalReport = report != null ? report : "(diagnóstico vazio)";
            runOnUiThread(() -> tv.setText(prefinal + finalReport));
        });
    }

    private void showRemoveDialog(final JSONObject cam) {
        final String mac  = cam.optString("mac", "");
        final String name = cam.optString("name", "Câmera");
        final String ip   = cam.optString("ip", "");

        android.app.AlertDialog.Builder b = new android.app.AlertDialog.Builder(this);
        b.setTitle("Remover " + name + "?");
        b.setMessage(
            "Escolha como deseja remover esta câmera:\n\n" +
            "• Resetar câmera: apaga o Wi-Fi da câmera e ela volta ao modo de pareamento " +
            "(LED piscando). Necessário para reconfigurar.\n\n" +
            "• Remover só do app: mantém a câmera configurada no Wi-Fi atual, " +
            "apenas apaga o registro local."
        );
        b.setPositiveButton("Resetar câmera", (d, w) -> resetCameraAndRemove(cam));
        b.setNeutralButton("Remover só do app", (d, w) -> {
            deleteCamera(mac);
            renderMyCameras();
            toast("Câmera removida do app");
        });
        b.setNegativeButton("Cancelar", null);
        b.show();
    }

    private void resetCameraAndRemove(final JSONObject cam) {
        final String mac  = cam.optString("mac", "");
        final String name = cam.optString("name", "Câmera");
        final String sn   = cam.optString("sn", "");
        final String savedIp = cam.optString("ip", "");

        // Senha da câmera — normalmente vazia. Mantemos o campo do wizard se foi preenchido.
        final String camPass = cameraPassInput != null
                ? cameraPassInput.getText().toString().trim() : "";
        final String camUser = "admin"; // padrão XM (não yura)

        toast("Procurando câmera na rede...");
        pool.execute(() -> {
            String ip = savedIp;
            if (ip == null || ip.isEmpty()) ip = findCameraIpOnLan(sn, mac);
            if (ip == null || ip.isEmpty()) {
                runOnUiThread(() -> {
                    new android.app.AlertDialog.Builder(this)
                        .setTitle("Câmera não encontrada")
                        .setMessage(
                            "Não foi possível encontrar a câmera " + name + " na rede.\n\n" +
                            "Para resetar manualmente, segure o botão de reset físico da câmera " +
                            "por 5 a 10 segundos até o LED voltar a piscar.\n\n" +
                            "Deseja apenas remover do app?")
                        .setPositiveButton("Remover do app", (d, w) -> {
                            deleteCamera(mac);
                            renderMyCameras();
                            toast("Câmera removida do app");
                        })
                        .setNegativeButton("Cancelar", null)
                        .show();
                });
                return;
            }
            final String foundIp = ip;
            runOnUiThread(() -> toast("Câmera em " + foundIp + ". Resetando..."));
            try {
                dvripFactoryReset(foundIp, camUser, camPass);
                runOnUiThread(() -> {
                    deleteCamera(mac);
                    renderMyCameras();
                    toast("✓ Câmera resetada e removida. Aguarde alguns segundos para reconfigurar.");
                });
            } catch (Exception e) {
                // Tenta com usuário "yura" (alternativo) se admin falhou
                if (camUser.equals("admin")) {
                    try {
                        dvripFactoryReset(foundIp, "yura", camPass);
                        runOnUiThread(() -> {
                            deleteCamera(mac);
                            renderMyCameras();
                            toast("✓ Câmera resetada e removida.");
                        });
                        return;
                    } catch (Exception ignored) {}
                }
                final String err = e.getMessage();
                runOnUiThread(() -> {
                    new android.app.AlertDialog.Builder(this)
                        .setTitle("Falha ao resetar")
                        .setMessage(
                            "Não foi possível resetar a câmera remotamente:\n" + err + "\n\n" +
                            "Faça o reset manualmente pelo botão físico da câmera " +
                            "(segurar por 5-10 segundos até o LED piscar).\n\n" +
                            "Deseja remover apenas do app?")
                        .setPositiveButton("Remover do app", (d, w) -> {
                            deleteCamera(mac);
                            renderMyCameras();
                            toast("Câmera removida do app");
                        })
                        .setNegativeButton("Cancelar", null)
                        .show();
                });
            }
        });
    }

    private String formatDate(long ts) {
        java.text.SimpleDateFormat sdf = new java.text.SimpleDateFormat("dd/MM/yyyy HH:mm", new java.util.Locale("pt", "BR"));
        return sdf.format(new java.util.Date(ts));
    }

    // ── Persistência de câmeras ───────────────────────────────────────────────

    // ── Banco local SQLite ────────────────────────────────────────────────────
    // Banco SQLite em getDatabasePath() — sobrevive a atualizações do APK,
    // suporta upgrade de schema, é o storage local padrão Android para dados
    // estruturados. Snapshot armazenado como BLOB na própria tabela, então
    // tudo está num único arquivo (cameras.db) — fácil de fazer backup/export.

    private static class CamerasDb extends SQLiteOpenHelper {
        static final String DB_NAME    = "cameras.db";
        static final int    DB_VERSION = 1;
        static final String TABLE      = "cameras";

        CamerasDb(android.content.Context ctx) { super(ctx, DB_NAME, null, DB_VERSION); }

        @Override
        public void onCreate(SQLiteDatabase db) {
            db.execSQL(
                "CREATE TABLE " + TABLE + " (" +
                "  mac           TEXT PRIMARY KEY," +
                "  name          TEXT NOT NULL," +
                "  ssid          TEXT," +
                "  sn            TEXT," +
                "  ip            TEXT," +
                "  configured_at INTEGER NOT NULL," +
                "  snapshot      BLOB," +
                "  snapshot_at   INTEGER" +
                ")"
            );
        }

        @Override
        public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {
            // Versão 1 inicial — sem upgrades ainda
        }
    }

    private CamerasDb dbHelper;

    private CamerasDb db() {
        if (dbHelper == null) dbHelper = new CamerasDb(getApplicationContext());
        return dbHelper;
    }

    private void saveConfiguredCamera() {
        try {
            String mac = selectedCameraMac != null ? selectedCameraMac : "";
            if (mac.isEmpty()) return;

            // Preserva campos antigos (snapshot, ip) se já existir
            JSONObject existing = findCamera(mac);

            ContentValues cv = new ContentValues();
            cv.put("mac",  mac);
            cv.put("name", selectedCameraName != null ? selectedCameraName : "Câmera XM");
            cv.put("ssid", selectedWifiSsid != null ? selectedWifiSsid : "");
            cv.put("sn",   connectedDevSn != null && !connectedDevSn.isEmpty()
                    ? connectedDevSn
                    : (existing != null ? existing.optString("sn", "") : ""));
            cv.put("ip",   existing != null ? existing.optString("ip", "") : "");
            cv.put("configured_at", System.currentTimeMillis());

            SQLiteDatabase d = db().getWritableDatabase();
            d.insertWithOnConflict(CamerasDb.TABLE, null, cv, SQLiteDatabase.CONFLICT_REPLACE);

            int total = countCameras();
            logBle("✓ Câmera salva no SQLite (total: " + total + ")");
        } catch (Exception e) {
            logBle("Erro ao salvar câmera: " + e.getMessage());
        }
    }

    private int countCameras() {
        Cursor c = db().getReadableDatabase().rawQuery("SELECT COUNT(*) FROM " + CamerasDb.TABLE, null);
        try { return c.moveToFirst() ? c.getInt(0) : 0; }
        finally { c.close(); }
    }

    /** Carrega todas as câmeras como JSONArray (mantém API antiga para renderMyCameras). */
    private JSONArray loadSavedCameras() {
        JSONArray arr = new JSONArray();
        Cursor c = null;
        try {
            c = db().getReadableDatabase().query(CamerasDb.TABLE,
                new String[]{"mac", "name", "ssid", "sn", "ip", "configured_at", "snapshot_at"},
                null, null, null, null, "configured_at DESC");
            while (c.moveToNext()) {
                JSONObject o = new JSONObject();
                o.put("mac",  c.getString(0));
                o.put("name", c.getString(1));
                o.put("ssid", c.isNull(2) ? "" : c.getString(2));
                o.put("sn",   c.isNull(3) ? "" : c.getString(3));
                o.put("ip",   c.isNull(4) ? "" : c.getString(4));
                o.put("when", c.getLong(5));
                o.put("snapshotAt", c.isNull(6) ? 0L : c.getLong(6));
                arr.put(o);
            }
        } catch (Exception ignored) {
        } finally {
            if (c != null) c.close();
        }
        return arr;
    }

    private JSONObject findCamera(String mac) {
        if (mac == null) return null;
        Cursor c = null;
        try {
            c = db().getReadableDatabase().query(CamerasDb.TABLE,
                new String[]{"mac", "name", "ssid", "sn", "ip", "configured_at"},
                "mac = ? COLLATE NOCASE", new String[]{mac}, null, null, null);
            if (c.moveToFirst()) {
                JSONObject o = new JSONObject();
                o.put("mac",  c.getString(0));
                o.put("name", c.getString(1));
                o.put("ssid", c.isNull(2) ? "" : c.getString(2));
                o.put("sn",   c.isNull(3) ? "" : c.getString(3));
                o.put("ip",   c.isNull(4) ? "" : c.getString(4));
                o.put("when", c.getLong(5));
                return o;
            }
        } catch (Exception ignored) {
        } finally {
            if (c != null) c.close();
        }
        return null;
    }

    private void deleteCamera(String mac) {
        try {
            db().getWritableDatabase()
                .delete(CamerasDb.TABLE, "mac = ? COLLATE NOCASE", new String[]{mac});
            snapshotCache.remove(mac);
        } catch (Exception ignored) {}
    }

    private void updateSavedCameraIp(String mac, String ip) {
        try {
            ContentValues cv = new ContentValues();
            cv.put("ip", ip);
            db().getWritableDatabase()
                .update(CamerasDb.TABLE, cv, "mac = ? COLLATE NOCASE", new String[]{mac});
        } catch (Exception ignored) {}
    }

    private void saveSnapshotToDisk(String mac, Bitmap bmp) {
        try {
            ByteArrayOutputStream baos = new ByteArrayOutputStream();
            bmp.compress(Bitmap.CompressFormat.JPEG, 80, baos);
            ContentValues cv = new ContentValues();
            cv.put("snapshot",    baos.toByteArray());
            cv.put("snapshot_at", System.currentTimeMillis());
            db().getWritableDatabase()
                .update(CamerasDb.TABLE, cv, "mac = ? COLLATE NOCASE", new String[]{mac});
        } catch (Exception ignored) {}
    }

    private Bitmap loadSnapshotFromDisk(String mac) {
        if (mac == null) return null;
        Cursor c = null;
        try {
            c = db().getReadableDatabase().query(CamerasDb.TABLE,
                new String[]{"snapshot"},
                "mac = ? COLLATE NOCASE", new String[]{mac}, null, null, null);
            if (c.moveToFirst() && !c.isNull(0)) {
                byte[] bytes = c.getBlob(0);
                if (bytes != null && bytes.length > 0) {
                    return BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
                }
            }
        } catch (Exception ignored) {
        } finally {
            if (c != null) c.close();
        }
        return null;
    }

    // ── Snapshot HTTP (sem RTSP — usa endpoints comuns XM/ONVIF) ─────────────
    // Câmeras XM/iCSee modernas expõem snapshot JPEG via HTTP em portas como
    // 80 e 8899. Como o IP pode mudar, varremos a subnet local procurando
    // a câmera pelo MAC (ARP) ou pelo SN (DVRIP scan).

    private void fetchSnapshotAsync(final JSONObject cam, final ImageView thumb, final TextView placeholder) {
        final String savedMac = cam.optString("mac", "");
        final String savedSn  = cam.optString("sn", "");
        String savedIp        = cam.optString("ip", "");

        pool.execute(() -> {
            String ip = savedIp;
            // Se não tem IP salvo, tenta descobrir por DVRIP scan na subnet
            if (ip.isEmpty()) {
                ip = findCameraIpOnLan(savedSn, savedMac);
                if (ip != null && !ip.isEmpty()) {
                    updateSavedCameraIp(savedMac, ip);
                }
            }
            if (ip == null || ip.isEmpty()) {
                runOnUiThread(() -> placeholder.setText("Câmera não encontrada na rede.\nConfirme que ela está ligada e no mesmo Wi-Fi."));
                return;
            }
            final String finalIp = ip;
            // Tenta endpoints comuns de snapshot JPG
            String[] urls = {
                "http://" + ip + "/cgi-bin/snapshot.cgi",
                "http://" + ip + ":8080/cgi-bin/snapshot.cgi",
                "http://" + ip + ":8899/snapshot.cgi",
                "http://" + ip + "/snapshot.jpg",
                "http://" + ip + "/jpg/image.jpg",
                "http://" + ip + ":80/onvif-http/snapshot",
            };
            Bitmap bmp = null;
            String tried = "";
            for (String url : urls) {
                bmp = downloadJpeg(url);
                if (bmp != null) { tried = url; break; }
            }
            final Bitmap finalBmp = bmp;
            final String triedUrl = tried;
            // Persiste no SQLite (BLOB) para sobreviver reinicialização
            if (bmp != null) saveSnapshotToDisk(savedMac, bmp);
            runOnUiThread(() -> {
                if (finalBmp != null) {
                    snapshotCache.put(savedMac, finalBmp);
                    thumb.setImageBitmap(finalBmp);
                    placeholder.setVisibility(View.GONE);
                    toast("Snapshot obtido");
                } else {
                    placeholder.setText("Câmera encontrada em " + finalIp + ",\nmas snapshot HTTP não respondeu.\nFirmware pode exigir RTSP ou login.");
                }
            });
        });
    }

    private Bitmap downloadJpeg(String url) {
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL(url).openConnection();
            c.setConnectTimeout(2500);
            c.setReadTimeout(3500);
            c.setRequestProperty("User-Agent", "VigiaEscolar/1.0");
            int code = c.getResponseCode();
            if (code != 200) return null;
            InputStream is = c.getInputStream();
            Bitmap b = BitmapFactory.decodeStream(is);
            try { is.close(); } catch (Exception ignored) {}
            return b;
        } catch (Exception e) {
            return null;
        } finally {
            if (c != null) c.disconnect();
        }
    }

    /**
     * Varre subnet local procurando câmera XM. Quando achar host com DVRIP
     * aberta (porta 34567), valida que é a câmera certa pelo SN via OPMachine.
     * Se sn vazio, aceita qualquer câmera XM como fallback.
     */
    private String findCameraIpOnLan(String sn, String mac) {
        java.util.List<String> ips = localSubnetIps();
        java.util.concurrent.atomic.AtomicReference<String> found = new java.util.concurrent.atomic.AtomicReference<>(null);
        java.util.concurrent.atomic.AtomicReference<String> fallback = new java.util.concurrent.atomic.AtomicReference<>(null);
        java.util.List<java.util.concurrent.Future<?>> futures = new java.util.ArrayList<>();
        final String expectedSn = sn == null ? "" : sn.trim();
        for (String ip : ips) {
            futures.add(pool.submit(() -> {
                if (found.get() != null) return;
                if (!isOpen(ip, 34567, 350)) return;
                // Porta aberta — tenta validar SN se conhecemos um
                if (expectedSn.isEmpty()) {
                    fallback.compareAndSet(null, ip);
                    return;
                }
                String remoteSn = dvripGetSerialNumber(ip);
                if (remoteSn != null && remoteSn.equalsIgnoreCase(expectedSn)) {
                    found.compareAndSet(null, ip);
                } else if (remoteSn != null) {
                    // É câmera XM mas SN diferente — guarda como fallback se não achar a certa
                    fallback.compareAndSet(null, ip);
                }
            }));
        }
        for (java.util.concurrent.Future<?> f : futures) {
            try { f.get(6, java.util.concurrent.TimeUnit.SECONDS); } catch (Exception ignored) {}
            if (found.get() != null) break;
        }
        return found.get() != null ? found.get() : fallback.get();
    }

    /**
     * Consulta SN da câmera via DVRIP OPMachine (sem login — algumas firmwares
     * deixam isso público; outras exigem login, nesse caso retorna null).
     * Usado para confirmar identidade de uma câmera achada na LAN.
     */
    private String dvripGetSerialNumber(String ip) {
        try (Socket s = new Socket()) {
            s.connect(new InetSocketAddress(ip, DVRIP_PORT), 1500);
            s.setSoTimeout(2500);
            InputStream in = s.getInputStream();
            OutputStream out = s.getOutputStream();
            // Tenta login anônimo (admin sem senha) primeiro
            JSONObject login = new JSONObject();
            login.put("EncryptType", "MD5");
            login.put("LoginType",   "DVRIP-Web");
            login.put("PassWord",    dvripMd5(""));
            login.put("UserName",    "admin");
            login.put("SessionID",   "0x0000000000");
            dvripSend(out, 0, seqNo.getAndIncrement(), MSG_LOGIN, login.toString().getBytes(StandardCharsets.UTF_8));
            JSONObject loginRsp = dvripRead(in);
            int ret = loginRsp.optInt("Ret", -1);
            if (ret != DVRIP_OK && ret != 101) return null;
            String sid = loginRsp.optString("SessionID", "0x0");
            int sessionInt = parseHex(sid);

            // GetSystemInfo (msg 1020) — retorna SerialNo
            JSONObject body = new JSONObject();
            body.put("Name",      "SystemInfo");
            body.put("SessionID", sid);
            dvripSend(out, sessionInt, seqNo.getAndIncrement(), 1020, body.toString().getBytes(StandardCharsets.UTF_8));
            JSONObject info = dvripRead(in);
            JSONObject sysInfo = info.optJSONObject("SystemInfo");
            if (sysInfo == null) return null;
            String snHex = sysInfo.optString("SerialNo", "");
            if (snHex == null || snHex.isEmpty()) return null;
            // Algumas firmwares retornam o SN como hex puro, outras como string
            return snHex.trim();
        } catch (Exception e) {
            return null;
        }
    }

    /**
     * Loop de descoberta após config: a câmera leva 10-40s pra entrar no Wi-Fi
     * e obter IP. Tenta a cada 8s por 90s. Quando achar, salva no DB local +
     * atualiza no servidor (se já estiver cadastrada).
     */
    private void startCameraIpDiscovery() {
        if (ipDiscoveryRunning) return;
        ipDiscoveryRunning = true;
        discoveredCameraIp = null;
        final String mac = selectedCameraMac;
        final String sn  = connectedDevSn != null ? connectedDevSn : "";
        logBle("🔍 Procurando IP da câmera na rede local (até 90s)...");
        pool.execute(() -> {
            long deadline = System.currentTimeMillis() + 90_000;
            while (System.currentTimeMillis() < deadline && discoveredCameraIp == null) {
                String ip = findCameraIpOnLan(sn, mac);
                if (ip != null && !ip.isEmpty()) {
                    discoveredCameraIp = ip;
                    runOnUiThread(() -> logBle("✓ Câmera encontrada em " + ip));
                    if (mac != null && !mac.isEmpty()) updateSavedCameraIp(mac, ip);
                    // Atualiza no servidor se já cadastrada
                    pushCameraIpToServer(mac, ip);
                    break;
                }
                try { Thread.sleep(8000); } catch (InterruptedException ie) { break; }
            }
            ipDiscoveryRunning = false;
            if (discoveredCameraIp == null) {
                runOnUiThread(() -> logBle("⚠ IP da câmera não encontrado em 90s. Você pode tentar de novo em \"Minhas câmeras\" → \"Atualizar miniatura\"."));
            }
        });
    }

    /** Faz PATCH (ou re-POST com upsert) na API para atualizar IP/streamUrl. */
    /**
     * Caminho legado: usado quando a câmera AINDA tem firmware Xiongmai
     * original (sem OpenIPC). Nesse caso o gateway VPS não consegue alcançar
     * o IP local — mas mantemos o registro caso um gateway local da escola
     * (raspberry pi) seja adicionado depois. Câmeras com OpenIPC já foram
     * cadastradas com URL rtsp://vigiaescolar.com.br:8554/live/<SN> e este
     * método não toca nelas.
     */
    private void pushCameraIpToServer(final String mac, final String ip) {
        if (apiToken == null || apiToken.isEmpty() || mac == null || mac.isEmpty()) return;
        final String apiUrl = API_BASE_URL;
        pool.execute(() -> {
            try {
                // GET /cameras para achar o ID dessa câmera pelo bluetoothMac
                HttpURLConnection c = (HttpURLConnection) new URL(apiUrl + "/cameras").openConnection();
                c.setRequestMethod("GET");
                c.setRequestProperty("Authorization", "Bearer " + apiToken);
                c.setConnectTimeout(5000); c.setReadTimeout(7000);
                if (c.getResponseCode() >= 300) return;
                String raw = readStream(c.getInputStream()).trim();
                JSONArray arr = raw.startsWith("[") ? new JSONArray(raw)
                        : new JSONObject(raw).optJSONArray("data");
                if (arr == null) return;
                String camId = null;
                JSONObject cam = null;
                for (int i = 0; i < arr.length(); i++) {
                    JSONObject co = arr.optJSONObject(i);
                    if (co != null && mac.equalsIgnoreCase(co.optString("bluetoothMac", ""))) {
                        camId = co.optString("id", "");
                        cam = co;
                        break;
                    }
                }
                if (camId == null || camId.isEmpty() || cam == null) return;

                // PUT /cameras/{id} com novo streamUrl baseado no IP
                String camPass = cameraPassInput != null ? cameraPassInput.getText().toString().trim() : "";
                String rtspUrl = "rtsp://" + ip + ":554/user=admin_password=" + camPass + "_channel=1_stream=0.sdp?real_stream";
                JSONObject payload = new JSONObject();
                payload.put("url", rtspUrl);
                payload.put("porta", 554);

                HttpURLConnection up = (HttpURLConnection) new URL(apiUrl + "/cameras/" + camId).openConnection();
                up.setRequestMethod("PUT");
                up.setRequestProperty("Content-Type", "application/json");
                up.setRequestProperty("Authorization", "Bearer " + apiToken);
                up.setConnectTimeout(5000); up.setReadTimeout(7000); up.setDoOutput(true);
                up.getOutputStream().write(payload.toString().getBytes(StandardCharsets.UTF_8));
                int code = up.getResponseCode();
                runOnUiThread(() -> logBle("Atualizando IP no servidor: HTTP " + code));
            } catch (Exception e) {
                runOnUiThread(() -> logBle("⚠ Falha ao atualizar IP no servidor: " + e.getMessage()));
            }
        });
    }

    // ── Inicializa widgets do fluxo legado (escondidos) ───────────────────────
    private void initLegacyWidgets() {
        // Estes widgets precisam existir para o código legado (modo AP, API, registro).
        // CRÍTICO: NÃO sobrescrever campos que já foram criados por buildPageXxx() —
        // senão os getText() apontam para inputs órfãos fora da árvore de views e
        // sempre retornam vazio. Só preenche os que ainda são null.
        if (wifiSsidInput     == null) wifiSsidInput     = input("");
        if (cameraIpInput     == null) { cameraIpInput   = input(""); cameraIpInput.setText(XM_AP_IP); }
        if (cameraUserInput   == null) { cameraUserInput = input(""); cameraUserInput.setText("yura"); }
        if (cameraApPassInput == null) cameraApPassInput = inputPass("");
        if (apiUrlInput       == null) apiUrlInput       = input("");
        if (emailInput        == null) emailInput        = input("");
        if (appPasswordInput  == null) appPasswordInput  = inputPass("");
        if (cameraNameInput   == null) { cameraNameInput = input(""); cameraNameInput.setText("Câmera XM iCSee"); }
        if (cameraLocInput    == null) cameraLocInput    = input("");
        if (schoolInput       == null) schoolInput       = input("");
        if (statusApi         == null) statusApi         = statusChip("Não conectado");
        if (networkList       == null) networkList       = vStack();
        if (apiList           == null) apiList           = vStack();
        if (schoolList        == null) schoolList        = vStack();
    }

    private void resetWizardState() {
        selectedCameraMac  = null;
        selectedCameraName = null;
        selectedWifiSsid   = null;
        selectedWifiCaps   = null;
        if (wifiPassInput != null) wifiPassInput.setText("");
        if (cameraPassInput != null) cameraPassInput.setText("");
        if (bleDeviceList != null) bleDeviceList.removeAllViews();
        if (wifiNetworkList != null) wifiNetworkList.removeAllViews();
        clearLogs();
        authPasswordSent = false;
        connectedDevSn = null;
    }

    // ── Ações do wizard ───────────────────────────────────────────────────────

    private void onCameraSelected(String mac, String name) {
        selectedCameraMac  = mac;
        selectedCameraName = name;
        if (bleScanning) stopBleScan();
        if (selectedCameraLabel != null) {
            selectedCameraLabel.setText("✓ Câmera selecionada: " + name);
        }
        showStep(WIZ_PICK_WIFI);
        scanWifiNetworks();
    }

    private void onWifiSelected(String ssid, String capabilities) {
        selectedWifiSsid = ssid;
        selectedWifiCaps = capabilities != null ? capabilities : "";
        if (selectedWifiLabel != null) {
            selectedWifiLabel.setText("Rede: " + ssid);
        }
        if (wifiSsidInput != null) wifiSsidInput.setText(ssid);
        boolean open = isOpenNetwork(selectedWifiCaps);
        if (open && wifiPassInput != null) wifiPassInput.setText("");
        showStep(WIZ_WIFI_PASSWORD);
    }

    private void showManualSsidDialog() {
        // Dialog simples para digitar SSID
        android.app.AlertDialog.Builder b = new android.app.AlertDialog.Builder(this);
        b.setTitle("Nome da rede Wi-Fi");
        final EditText et = input("Nome da rede (SSID)");
        LinearLayout wrap = vStack();
        wrap.setPadding(dp(18), dp(8), dp(18), 0);
        wrap.addView(et);
        b.setView(wrap);
        b.setPositiveButton("Continuar", (d, w) -> {
            String ssid = et.getText().toString().trim();
            if (ssid.isEmpty()) { toast("Informe o nome da rede"); return; }
            onWifiSelected(ssid, "[WPA2-PSK]");  // assume WPA2 quando manual
        });
        b.setNegativeButton("Cancelar", null);
        b.show();
    }

    private void startConfiguration() {
        if (selectedCameraMac == null) { toast("Selecione a câmera primeiro"); return; }
        if (selectedWifiSsid == null)  { toast("Selecione a rede Wi-Fi primeiro"); return; }
        if (wifiSsidInput != null) wifiSsidInput.setText(selectedWifiSsid);
        showStep(WIZ_CONFIGURING);
        connectBleDevice(selectedCameraMac, selectedCameraName);
    }

    private boolean isOpenNetwork(String capabilities) {
        if (capabilities == null) return true;
        String c = capabilities.toUpperCase(Locale.US);
        return !c.contains("WPA") && !c.contains("WEP") && !c.contains("PSK");
    }

    // ── Scan WiFi (lista redes próximas) ──────────────────────────────────────

    @SuppressLint("MissingPermission")
    private void scanWifiNetworks() {
        if (wifiNetworkList == null) return;
        wifiNetworkList.removeAllViews();

        WifiManager wm = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
        if (wm == null) {
            wifiNetworkList.addView(muted("Wi-Fi indisponível neste dispositivo."));
            return;
        }
        if (!wm.isWifiEnabled()) {
            wifiNetworkList.addView(muted("Wi-Fi está desligado. Ative o Wi-Fi nas configurações do celular."));
            return;
        }

        try {
            wm.startScan();
        } catch (Exception ignored) {}

        java.util.List<android.net.wifi.ScanResult> results;
        try {
            results = wm.getScanResults();
        } catch (SecurityException se) {
            wifiNetworkList.addView(muted("Sem permissão para listar redes Wi-Fi. Conceda Localização."));
            return;
        }

        if (results == null || results.isEmpty()) {
            wifiNetworkList.addView(muted("Nenhuma rede encontrada. Toque em \"Atualizar\" novamente em alguns segundos."));
            return;
        }

        // Dedup por SSID (mantém o de maior RSSI), filtra vazios e 5GHz
        java.util.Map<String, android.net.wifi.ScanResult> bySsid = new java.util.HashMap<>();
        for (android.net.wifi.ScanResult r : results) {
            if (r.SSID == null || r.SSID.isEmpty()) continue;
            // Câmera XM só suporta 2,4 GHz → filtra 5 GHz (frequencies 5000-6000)
            if (r.frequency >= 4900 && r.frequency <= 5900) continue;
            android.net.wifi.ScanResult prev = bySsid.get(r.SSID);
            if (prev == null || r.level > prev.level) bySsid.put(r.SSID, r);
        }
        java.util.List<android.net.wifi.ScanResult> sorted = new java.util.ArrayList<>(bySsid.values());
        java.util.Collections.sort(sorted, (a, b) -> Integer.compare(b.level, a.level));

        if (sorted.isEmpty()) {
            wifiNetworkList.addView(muted("Nenhuma rede 2,4 GHz encontrada. A câmera só suporta 2,4 GHz."));
            return;
        }

        for (android.net.wifi.ScanResult r : sorted) {
            String ssid = r.SSID;
            String caps = r.capabilities != null ? r.capabilities : "";
            boolean open = isOpenNetwork(caps);
            int dbm = r.level;
            int bars = dbm >= -55 ? 4 : dbm >= -65 ? 3 : dbm >= -75 ? 2 : 1;
            String barsStr = repeat("▮", bars) + repeat("▯", 4 - bars);
            String label = ssid + "\n" + barsStr + "  " + dbm + " dBm  " + (open ? "Aberta" : "Protegida");
            Button btn = listBtn(label, v -> onWifiSelected(ssid, caps));
            wifiNetworkList.addView(btn);
        }
    }

    private String repeat(String s, int n) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < n; i++) sb.append(s);
        return sb.toString();
    }

    /**
     * Replica e.x.f.b(capabilities) do iCSee: traduz capabilities WiFi para o
     * código de encriptação esperado pela câmera XM (1 byte).
     * Capabilities é a string que vem em ScanResult.capabilities, ex: "[WPA2-PSK-CCMP+TKIP][ESS]".
     *
     * Retorno:
     *   0=OPEN  1=WEP  2=WPA_PSK (literal)
     *   3=WPA(2)+PSK (não WPA-WPA2)  4=WPA-PSK (legado)  5=WPA2-ENTERPRISE
     *   6=WPA-PSK  7=WPA3+WPA2+PSK  8=WAPI+PSK
     */
    private int encrypFromCapabilities(String capabilities, String passwd) {
        if (passwd == null || passwd.isEmpty()) return 0;  // sem senha = OPEN
        if (capabilities == null || capabilities.isEmpty()) return 6;  // assume WPA2-PSK comum
        String c = capabilities.toUpperCase(Locale.US);

        if (c.contains("WAPI") && c.contains("PSK")) return 8;
        if (c.contains("WPA3") && c.contains("WPA2") && c.contains("PSK")) return 7;
        if (c.contains("WPA3") && c.contains("PSK")) return 6;
        if (c.contains("WPA2") && c.contains("ENTERPRISE")) return 5;
        if (c.contains("WPA2") && c.contains("PSK")) return 6;  // mais comum (escola)
        if (c.contains("WPA") && c.contains("PSK")) return 3;
        if (c.contains("WPA_PSK")) return 2;
        if (c.contains("WEP")) return 1;
        return 0;
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

        // Re-inicializa BLE se necessário (ex.: usuário ligou o Bluetooth agora)
        if (bleAdapter == null || !bleAdapter.isEnabled()) {
            initBle();
        }
        if (bleAdapter == null) {
            setChip(statusBle, "Bluetooth indisponível", Color.rgb(185, 28, 28));
            logBle("✗ Bluetooth não disponível neste dispositivo");
            toast("Este dispositivo não tem Bluetooth");
            return;
        }
        if (!bleAdapter.isEnabled()) {
            setChip(statusBle, "Bluetooth desligado", Color.rgb(185, 28, 28));
            logBle("✗ Bluetooth está desligado — ative nas configurações");
            toast("Ative o Bluetooth no celular");
            return;
        }

        // Verifica permissões em runtime ANTES de tentar escanear
        java.util.List<String> missing = new java.util.ArrayList<>();
        if (Build.VERSION.SDK_INT >= 31) {
            if (checkSelfPermission(Manifest.permission.BLUETOOTH_SCAN) != PackageManager.PERMISSION_GRANTED)
                missing.add(Manifest.permission.BLUETOOTH_SCAN);
            if (checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED)
                missing.add(Manifest.permission.BLUETOOTH_CONNECT);
        }
        if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED)
            missing.add(Manifest.permission.ACCESS_FINE_LOCATION);

        if (!missing.isEmpty()) {
            logBle("⚠ Permissões necessárias faltando: " + missing);
            setChip(statusBle, "Conceda permissões e tente novamente", Color.rgb(185, 28, 28));
            toast("Conceda as permissões pedidas e toque em \"Procurar\" novamente");
            requestPermissions(missing.toArray(new String[0]), 70);
            return;
        }

        // Garante que o scanner novo está disponível como fallback
        if (bleScanner == null) bleScanner = bleAdapter.getBluetoothLeScanner();

        foundDevices.clear();
        scannedDevices.clear();
        if (bleDeviceList != null) bleDeviceList.removeAllViews();
        bleScanning = true;
        if (bleScanButton != null) bleScanButton.setText("Parar busca BLE");
        setChip(statusBle, "Escaneando... (60s)", COLOR_BLUE_MED);
        logBle("Buscando câmeras XM/iCSee... Coloque a câmera em modo de emparelhamento (LED piscando).");

        // Usa API legada startLeScan — exatamente como o app iCSee original
        // Isso produz BluetoothDevice com tipo correto, ao contrário de BluetoothLeScanner
        boolean started = false;
        try { started = bleAdapter.startLeScan(legacyScanCallback); }
        catch (SecurityException se) { logBle("✗ SecurityException no startLeScan: " + se.getMessage()); }
        catch (Exception e)          { logBle("✗ Erro no startLeScan: " + e.getMessage()); }
        logBle("startLeScan (API legada): " + (started ? "OK" : "falhou — tentando API nova"));
        if (!started && bleScanner != null) {
            try {
                bleScanner.startScan(newScanCallback);
                logBle("BluetoothLeScanner (API nova) iniciado como fallback");
            } catch (Exception e) {
                logBle("✗ BluetoothLeScanner também falhou: " + e.getMessage());
                setChip(statusBle, "Erro ao iniciar busca", Color.rgb(185, 28, 28));
                bleScanning = false;
                return;
            }
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
        String tag = confirmed ? "[CÂMERA ✓] " : "[BLE] ";
        String label = tag + name + "\n" + mac + "   " + rssi + " dBm\nToque para selecionar";
        Button btn = listBtn(label, v -> onCameraSelected(mac, name));
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
                runOnUiThread(() -> {
                    logBle("✓ STATE_CONNECTED! Limpando cache GATT e solicitando MTU...");
                    if (configStatusLabel != null) configStatusLabel.setText("Conectado à câmera. Negociando canal de comunicação...");
                });
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

            // Loga TODAS chars do serviço 0x1910 com suas props para diagnóstico
            // PROPERTY_BROADCAST=0x01 READ=0x02 WRITE_NO_RESP=0x04 WRITE=0x08
            // NOTIFY=0x10 INDICATE=0x20 SIGNED_WRITE=0x40
            StringBuilder cs = new StringBuilder("Chars do serviço 0x1910:");
            for (BluetoothGattCharacteristic c : svc.getCharacteristics()) {
                int p = c.getProperties();
                cs.append("\n  ").append(c.getUuid())
                  .append(" props=0x").append(Integer.toHexString(p))
                  .append(" [")
                  .append((p & 0x02) != 0 ? "R" : "")
                  .append((p & 0x04) != 0 ? "Wn" : "")
                  .append((p & 0x08) != 0 ? "W" : "")
                  .append((p & 0x10) != 0 ? "N" : "")
                  .append((p & 0x20) != 0 ? "I" : "")
                  .append("]");
            }
            runOnUiThread(() -> logBle(cs.toString()));

            // Passo 3: habilitar notify em 0x2b10 (a char com PROPERTY_NOTIFY)
            BluetoothGattCharacteristic notifyChar = svc.getCharacteristic(UUID_NOTIFY);
            if (notifyChar == null) {
                StringBuilder sb = new StringBuilder();
                for (BluetoothGattCharacteristic c : svc.getCharacteristics()) {
                    sb.append("\n  char ").append(c.getUuid()).append(" props=0x").append(Integer.toHexString(c.getProperties()));
                }
                runOnUiThread(() -> logBle("✗ Notify 0x2b11 não encontrada. Chars disponíveis:" + sb));
                return;
            }
            int props = notifyChar.getProperties();
            runOnUiThread(() -> logBle("Notify char encontrada, props=0x" + Integer.toHexString(props)));

            boolean ok = gatt.setCharacteristicNotification(notifyChar, true);
            runOnUiThread(() -> logBle("setCharacteristicNotification: " + ok));

            // Lista TODOS descriptors da char — XM às vezes expõe CCCD com UUID base diferente
            BluetoothGattDescriptor cccdDesc = notifyChar.getDescriptor(UUID_CCCD);
            if (cccdDesc == null) {
                StringBuilder dsb = new StringBuilder();
                for (BluetoothGattDescriptor d : notifyChar.getDescriptors()) {
                    dsb.append("\n  descriptor ").append(d.getUuid());
                }
                runOnUiThread(() -> logBle("CCCD 0x2902 não retornado. Descriptors disponíveis:" + dsb));

                // Tenta usar o primeiro descriptor disponível (algumas firmwares XM expõem o CCCD com UUID custom)
                java.util.List<BluetoothGattDescriptor> all = notifyChar.getDescriptors();
                if (!all.isEmpty()) {
                    cccdDesc = all.get(0);
                    final BluetoothGattDescriptor fallbackDesc = cccdDesc;
                    runOnUiThread(() -> logBle("Usando primeiro descriptor disponível: " + fallbackDesc.getUuid()));
                }
            }

            // iCSee escreve ENABLE_NOTIFICATION_VALUE (0x01,0x00) no CCCD para habilitar notify
            if (cccdDesc != null) {
                final BluetoothGattDescriptor d = cccdDesc;
                // Pequeno delay entre setCharacteristicNotification e writeDescriptor — alguns
                // firmwares XM/Xiaomi precisam disso para registrar a inscrição no stack
                mainHandler.postDelayed(() -> {
                    boolean wrote;
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                        int rc = gatt.writeDescriptor(d, BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE);
                        wrote = (rc == BluetoothGatt.GATT_SUCCESS || rc == 0);
                        logBle("writeDescriptor CCCD (API33+): rc=" + rc);
                    } else {
                        d.setValue(BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE);
                        wrote = gatt.writeDescriptor(d);
                        logBle("writeDescriptor CCCD: " + wrote);
                    }
                    if (!wrote) logBle("⚠ writeDescriptor retornou false — aguardando notify implícito");
                }, 150);
            } else {
                // Sem CCCD: alguns firmwares XM mandam DEV_INFO mesmo assim
                runOnUiThread(() -> logBle("⚠ Sem CCCD — aguardando frame da câmera (notify implícito)..."));
            }
        }

        @SuppressLint("MissingPermission")
        @Override
        public void onDescriptorWrite(BluetoothGatt gatt, BluetoothGattDescriptor descriptor, int status) {
            runOnUiThread(() -> {
                logBle("CCCD write status=" + status + ". Aguardando frame inicial da câmera...");
                if (configStatusLabel != null) configStatusLabel.setText("Conectado. Enviando configuração Wi-Fi...");
            });
            // Câmera envia GET_NETWORK_STATE callback automaticamente após notify habilitado.
            // Timeout 5s: se nada chegar, envia CONNECT_WIFI direto.
            mainHandler.postDelayed(() -> {
                if (bleConnected && !authPasswordSent && bleGatt == gatt) {
                    runOnUiThread(() -> logBle("Timeout 5s sem frame inicial — enviando CONNECT_WIFI direto..."));
                    sendConnectWifiByBle(gatt);
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
        int show = Math.min(data.length, 32);
        for (int i = 0; i < show; i++) hex.append(String.format("%02X ", data[i]));
        String hexStr = hex.toString().trim() + (data.length > 32 ? "..." : "");
        runOnUiThread(() -> logBle("← BLE [" + data.length + "b] " + hexStr));

        // Parse do frame XM real: 8B 8B VER CMD FUN(2) DT LEN(2) CONTENT CSUM
        if (data.length < 10) {
            runOnUiThread(() -> logBle("  frame curto demais (" + data.length + "b) — ignorando"));
            return;
        }
        if ((data[0] & 0xFF) != 0x8B || (data[1] & 0xFF) != 0x8B) {
            runOnUiThread(() -> logBle("  header inválido (esperado 8B 8B)"));
            return;
        }
        int version    = data[2] & 0xFF;
        int cmdId      = data[3] & 0xFF;
        int funId      = ((data[4] & 0xFF) << 8) | (data[5] & 0xFF);
        int dataType   = data[6] & 0xFF;
        int contentLen = ((data[7] & 0xFF) << 8) | (data[8] & 0xFF);
        runOnUiThread(() -> logBle("  ver=" + version + " cmd=" + cmdId + " fun=0x" + String.format("%04X", funId) + " dt=" + dataType + " len=" + contentLen));

        if (9 + contentLen + 1 > data.length) {
            runOnUiThread(() -> logBle("  frame truncado (esperava " + (9 + contentLen + 1) + "b, recebeu " + data.length + "b)"));
            return;
        }

        byte[] content = new byte[contentLen];
        if (contentLen > 0) System.arraycopy(data, 9, content, 0, contentLen);

        // Valida checksum (soma de todos bytes anteriores mod 256)
        int sumCalc = 0;
        for (int i = 0; i < 9 + contentLen; i++) sumCalc = (sumCalc + (data[i] & 0xFF)) & 0xFF;
        final int calc = sumCalc;
        final int recvCsum = data[9 + contentLen] & 0xFF;
        if (calc != recvCsum) {
            runOnUiThread(() -> logBle("  ⚠ checksum mismatch (calc=" + calc + " recv=" + recvCsum + ") — processando mesmo assim"));
        }

        runOnUiThread(() -> handleXmFrame(gatt, cmdId, funId, dataType, content));
    }

    /**
     * Processa frame XM já parseado.
     * cmdId: 1=SEND 2=RECEIVE 3=CALLBACK
     * funId: 0x0001=GET_NETWORK_STATE, 0x0002=CONNECT_WIFI_BY_BLE, 0x0003=CONNECT_WIFI_BY_AP
     */
    private void handleXmFrame(BluetoothGatt gatt, int cmdId, int funId, int dataType, byte[] content) {
        if (funId == FUN_GET_NETWORK_STATE) {
            // Câmera envia/responde estado de rede. Se cmdId=CALLBACK (3) e content[0]=0,
            // pode significar "online". Vamos logar e enviar Connect WiFi.
            if (content.length > 0) {
                logBle("Network state: " + (content[0] & 0xFF));
            }
            // Após handshake inicial (câmera mandou GET_NETWORK_STATE callback),
            // podemos enviar nosso CONNECT_WIFI_BY_BLE
            if (cmdId == CMD_RECEIVE || cmdId == CMD_CALLBACK) {
                if (!authPasswordSent) {
                    logBle("→ Enviando CONNECT_WIFI_BY_BLE...");
                    sendConnectWifiByBle(gatt);
                }
            }
        } else if (funId == FUN_CONNECT_WIFI_BY_BLE) {
            // Resposta da câmera ao nosso comando CONNECT_WIFI_BY_BLE
            int result = content.length > 0 ? (content[0] & 0xFF) : -1;
            if (result == 0x00) {
                logBle("✓ Câmera aceitou Wi-Fi! Aguarde conectar (LED fixo).");
                setChip(statusBle, "Wi-Fi configurado ✓", COLOR_GREEN);
                if (configStatusLabel != null) configStatusLabel.setText("Wi-Fi enviado com sucesso!");
                // Salva câmera localmente para aparecer em "Minhas câmeras"
                saveConfiguredCamera();
                mainHandler.postDelayed(this::disconnectBle, 1500);
                // Dispara descoberta de IP em background: a câmera leva 10-40s
                // para conectar ao WiFi e obter IP via DHCP. Varremos por 90s.
                startCameraIpDiscovery();
                // Avança para tela de sucesso após 2s (deixa logs visíveis um instante)
                mainHandler.postDelayed(() -> showStep(WIZ_SUCCESS), 2000);
            } else {
                logBle("✗ Câmera recusou WiFi (result=0x" + String.format("%02X", result) + ")");
                setChip(statusBle, "Falha Wi-Fi", Color.rgb(185, 28, 28));
                if (configStatusLabel != null) configStatusLabel.setText("Câmera recusou a configuração. Verifique a senha do Wi-Fi.");
            }
        } else {
            // funId desconhecido — tenta logar conteúdo como string
            if (content.length > 0) {
                try {
                    String s = new String(content, StandardCharsets.UTF_8).trim();
                    if (!s.isEmpty()) logBle("  content: " + s.substring(0, Math.min(s.length(), 100)));
                } catch (Exception ignored) {}
            }
        }
    }

    /**
     * Constrói e envia frame CONNECT_WIFI_BY_BLE conforme bytecode iCSee (e.x.f.a).
     *
     * Content format (cada campo prefixado por len-1-byte):
     *   [ssidLen 1B] [ssidBytes] [pwdLen 1B] [pwdBytes] [encryp 1B]
     *
     * Onde encryp é o resultado de e.x.f.b(capabilities):
     *   0=OPEN  2=WPA_PSK  4=WPA-PSK  6=WPA+PSK  7=WPA3+WPA2+PSK  8=WAPI+PSK
     */
    @SuppressLint("MissingPermission")
    private void sendConnectWifiByBle(BluetoothGatt gatt) {
        String ssid     = wifiSsidInput.getText().toString().trim();
        String wifiPass = wifiPassInput.getText().toString().trim();

        if (ssid.isEmpty()) {
            logBle("✗ Informe o SSID (Passo 2) antes de configurar.");
            return;
        }

        byte[] ssidBytes = ssid.getBytes(StandardCharsets.UTF_8);
        byte[] passBytes = wifiPass.getBytes(StandardCharsets.UTF_8);
        // Encriptação detectada das capabilities da rede escolhida (replica e.x.f.b).
        // Fallback: 6 (WPA+PSK) se não houver capabilities ou se senha não-vazia.
        int encryp = encrypFromCapabilities(selectedWifiCaps, wifiPass);

        byte[] content = new byte[1 + ssidBytes.length + 1 + passBytes.length + 1];
        int offset = 0;
        content[offset++] = (byte) (ssidBytes.length & 0xFF);
        System.arraycopy(ssidBytes, 0, content, offset, ssidBytes.length);
        offset += ssidBytes.length;
        content[offset++] = (byte) (passBytes.length & 0xFF);
        System.arraycopy(passBytes, 0, content, offset, passBytes.length);
        offset += passBytes.length;
        content[offset] = (byte) (encryp & 0xFF);

        byte[] frame = buildBleFrame(CMD_SEND, FUN_CONNECT_WIFI_BY_BLE, DT_BINARY_NO_ENCRYPTION, content);
        logBle("→ CONNECT_WIFI_BY_BLE SSID='" + ssid + "' enc=" + encryp + " contentLen=" + content.length);
        authPasswordSent = true;
        writeBluetoothChar(gatt, frame);
    }

    // ─── Protocolo BLE XM (versão real) ──────────────────────────────────────
    // sendConnectWifiByBle() acima é o ponto principal. Métodos legados removidos
    // após reescrita do protocolo baseada na decompilação completa de XMBleData
    // e e.x.f no APK iCSee v7.1.1.

    /**
     * Frame BLE XM real (validado com bytecode iCSee XMBleData.parseData):
     *
     *   [0x8B 0x8B] [VER 1B] [CMD 1B] [FUN 2B BE] [DT 1B] [LEN 2B BE] [CONTENT N] [CSUM 1B]
     *
     * CSUM = (soma de TODOS os bytes anteriores) mod 256
     * Cabeçalho fixo total = 9 bytes; com content e checksum = 10 + content.length bytes
     */
    private byte[] buildBleFrame(byte cmdId, int funId, byte dataType, byte[] content) {
        int contentLen = content != null ? content.length : 0;
        byte[] frame = new byte[10 + contentLen];
        frame[0] = BLE_HEAD_1;
        frame[1] = BLE_HEAD_2;
        frame[2] = 0x01;                                     // version
        frame[3] = cmdId;
        frame[4] = (byte) ((funId >> 8) & 0xFF);             // FUN hi (big-endian)
        frame[5] = (byte) (funId & 0xFF);                    // FUN lo
        frame[6] = dataType;
        frame[7] = (byte) ((contentLen >> 8) & 0xFF);        // LEN hi (big-endian)
        frame[8] = (byte) (contentLen & 0xFF);               // LEN lo
        if (content != null) System.arraycopy(content, 0, frame, 9, contentLen);
        // checksum = soma de todos os bytes anteriores mod 256
        int sum = 0;
        for (int i = 0; i < 9 + contentLen; i++) sum = (sum + (frame[i] & 0xFF)) & 0xFF;
        frame[9 + contentLen] = (byte) sum;
        return frame;
    }

    // Mantido para chamadas antigas que passavam só (funId, data) — agora delega
    private byte[] buildBleFrame(byte funId, byte[] data) {
        // legado: assume CMD_SEND + funId byte como if it were 16-bit + DT_BIN_NOENC
        return buildBleFrame(CMD_SEND, funId & 0xFF, DT_BINARY_NO_ENCRYPTION, data);
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

    /**
     * Reset de fábrica via DVRIP. Reverte câmera para o estado inicial — apaga
     * Wi-Fi configurado e ela volta a anunciar no Bluetooth (modo de pareamento)
     * após reboot.
     *
     * Reproduz o que o iCSee faz em DevAboutSettingActivity quando o usuário
     * toca em "Padrão de fábrica":
     *   1. Login DVRIP (usuário/senha)
     *   2. OPDefaultConfig com todos os flags = 1 (reseta todas as categorias)
     *   3. OPMachine Reboot — reinicia a câmera
     */
    private void dvripFactoryReset(String ip, String user, String pass) throws Exception {
        try (Socket socket = new Socket()) {
            socket.connect(new InetSocketAddress(ip, DVRIP_PORT), 4000);
            socket.setSoTimeout(8000);
            InputStream in = socket.getInputStream();
            OutputStream out = socket.getOutputStream();

            // 1. Login
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

            // 2. OPDefaultConfig — reseta todas as categorias (replica setAllConfig(1) do iCSee)
            JSONObject defaults = new JSONObject();
            defaults.put("Account",     1);
            defaults.put("Alarm",       1);
            defaults.put("CameraPARAM", 1);
            defaults.put("Encode",      1);
            defaults.put("General",     1);
            defaults.put("NetCommon",   1);
            defaults.put("NetService",  1);
            defaults.put("Preview",     1);
            defaults.put("PtzComm",     1);
            defaults.put("Record",      1);

            JSONObject resetBody = new JSONObject();
            resetBody.put("Name", "OPDefaultConfig");
            resetBody.put("SessionID", sid);
            resetBody.put("OPDefaultConfig", defaults);
            dvripSend(out, sessionInt, seqNo.getAndIncrement(), MSG_DEFAULT_CFG, resetBody.toString().getBytes(StandardCharsets.UTF_8));

            JSONObject resetRsp = dvripRead(in);
            int resetRet = resetRsp.optInt("Ret", -1);
            // Aceita Ret=100 (OK) ou Ret=515/516 (já em reset) — algumas firmwares
            if (resetRet != DVRIP_OK && resetRet != 515 && resetRet != 516)
                throw new Exception("OPDefaultConfig rejeitado (Ret=" + resetRet + ")");

            // 3. OPMachine Reboot — garante que a câmera realmente reinicia (alguns
            // firmwares precisam de reboot explícito após DefaultConfig)
            try {
                JSONObject reboot = new JSONObject();
                reboot.put("Action", "Reboot");
                JSONObject rebootBody = new JSONObject();
                rebootBody.put("Name", "OPMachine");
                rebootBody.put("SessionID", sid);
                rebootBody.put("OPMachine", reboot);
                dvripSend(out, sessionInt, seqNo.getAndIncrement(), MSG_REBOOT, rebootBody.toString().getBytes(StandardCharsets.UTF_8));
                // não tentamos ler resposta — câmera derruba conexão imediatamente
            } catch (Exception ignored) {
                // reboot pode falhar pois o socket já caiu — irrelevante, reset já passou
            }
        }
    }

    /**
     * Etapa 1 do roadmap OpenIPC: leitura SEGURA de info da câmera via DVRIP.
     * Nada é escrito. Roda vários GetConfig/SystemInfo e devolve dump completo
     * para análise manual da identificação de SoC, modelo e capacidades.
     *
     * Comandos executados:
     *  - SystemInfo                        (msg 1020)  → hardware, software, SoC
     *  - StorageInfo                       (msg 1024)  → flash size/partitions
     *  - NetWork.NetCommon                 (msg 1042)  → MAC, IP, gateway
     *  - General                           (msg 1042)  → timezone, language
     *  - OPMachine Action=GetMachineInfo   (msg 1450)  → info adicional
     *  - Uart.Comm                         (msg 1042)  → bauds, devicemode
     *  - Ability.SystemFunction            (msg 1360)  → funções suportadas
     *
     * Retorna o relatório como String multi-linha pronto pra copy/paste.
     */
    private String dvripDiagnostic(String ip, String user, String pass) {
        StringBuilder report = new StringBuilder();
        report.append("=== DIAGNÓSTICO DVRIP ===\n");
        report.append("IP: ").append(ip).append("\n");
        report.append("Usuário: ").append(user).append("\n");
        report.append("Data: ").append(formatDate(System.currentTimeMillis())).append("\n");
        report.append("\n");

        try (Socket s = new Socket()) {
            s.connect(new InetSocketAddress(ip, DVRIP_PORT), 4000);
            s.setSoTimeout(8000);
            InputStream in = s.getInputStream();
            OutputStream out = s.getOutputStream();

            // 1. Login
            JSONObject login = new JSONObject();
            login.put("EncryptType", "MD5");
            login.put("LoginType", "DVRIP-Web");
            login.put("PassWord", dvripMd5(pass));
            login.put("UserName", user);
            login.put("SessionID", "0x0000000000");
            dvripSend(out, 0, seqNo.getAndIncrement(), MSG_LOGIN, login.toString().getBytes(StandardCharsets.UTF_8));

            JSONObject loginRsp = dvripRead(in);
            int ret = loginRsp.optInt("Ret", -1);
            report.append("[1] LOGIN\n");
            report.append("    Ret: ").append(ret).append("\n");
            if (ret != DVRIP_OK && ret != 101) {
                report.append("    ✗ Login falhou — diagnóstico interrompido\n");
                report.append("    Tente outra senha (ex: vazia, '666666', 'tlJwpbo6').\n");
                return report.toString();
            }
            String sid = loginRsp.optString("SessionID", "0x0");
            int sessionInt = parseHex(sid);
            report.append("    SessionID: ").append(sid).append("\n");
            report.append("    Resposta completa: ").append(loginRsp.toString()).append("\n");
            report.append("\n");

            // 2. SystemInfo
            dvripQueryAndAppend(report, in, out, sessionInt, 1020, "SystemInfo");

            // 3. StorageInfo (algumas firmwares retornam Ret=102 se sem SD card — ok)
            dvripQueryAndAppend(report, in, out, sessionInt, 1024, "StorageInfo");

            // 4. NetWork.NetCommon — MAC, IP, gateway
            dvripQueryAndAppend(report, in, out, sessionInt, 1042, "NetWork.NetCommon");

            // 5. General — timezone, language, hardware version
            dvripQueryAndAppend(report, in, out, sessionInt, 1042, "General");

            // 6. OPMachine GetMachineInfo
            try {
                JSONObject getMachine = new JSONObject();
                getMachine.put("Name", "OPMachine");
                getMachine.put("SessionID", sid);
                JSONObject opm = new JSONObject();
                opm.put("Action", "GetMachineInfo");
                getMachine.put("OPMachine", opm);
                dvripSend(out, sessionInt, seqNo.getAndIncrement(), 1450, getMachine.toString().getBytes(StandardCharsets.UTF_8));
                JSONObject rsp = dvripRead(in);
                report.append("[6] OPMachine GetMachineInfo (msg 1450)\n");
                report.append("    Ret: ").append(rsp.optInt("Ret", -1)).append("\n");
                report.append("    Resposta: ").append(rsp.toString()).append("\n\n");
            } catch (Exception e) {
                report.append("[6] OPMachine GetMachineInfo: ERRO ").append(e.getMessage()).append("\n\n");
            }

            // 7. Ability.SystemFunction — funções suportadas pelo firmware
            try {
                JSONObject req = new JSONObject();
                req.put("Name", "SystemFunction");
                req.put("SessionID", sid);
                dvripSend(out, sessionInt, seqNo.getAndIncrement(), 1360, req.toString().getBytes(StandardCharsets.UTF_8));
                JSONObject rsp = dvripRead(in);
                report.append("[7] Ability.SystemFunction (msg 1360)\n");
                report.append("    Ret: ").append(rsp.optInt("Ret", -1)).append("\n");
                report.append("    Resposta: ").append(rsp.toString()).append("\n\n");
            } catch (Exception e) {
                report.append("[7] Ability.SystemFunction: ERRO ").append(e.getMessage()).append("\n\n");
            }

            // 8. Uart.Comm — info de portas seriais (ajuda identificar se tem TTL exposto)
            dvripQueryAndAppend(report, in, out, sessionInt, 1042, "Uart.Comm");

            // 9. fVideo.OSDInfo — versão de firmware visível no OSD
            dvripQueryAndAppend(report, in, out, sessionInt, 1042, "fVideo.OSDInfo");

        } catch (Exception e) {
            report.append("\n✗ Erro de conexão DVRIP: ").append(e.getMessage()).append("\n");
        }
        report.append("=== FIM DIAGNÓSTICO ===\n");
        return report.toString();
    }

    /** Helper: faz GetConfig de um Name específico via msgId 1042 e anexa ao relatório. */
    private void dvripQueryAndAppend(StringBuilder report, InputStream in, OutputStream out,
                                     int sessionInt, int msgId, String name) {
        try {
            JSONObject req = new JSONObject();
            req.put("Name", name);
            req.put("SessionID", String.format("0x%08X", sessionInt));
            dvripSend(out, sessionInt, seqNo.getAndIncrement(), msgId, req.toString().getBytes(StandardCharsets.UTF_8));
            JSONObject rsp = dvripRead(in);
            report.append("[Q] ").append(name).append(" (msg ").append(msgId).append(")\n");
            report.append("    Ret: ").append(rsp.optInt("Ret", -1)).append("\n");
            report.append("    Resposta: ").append(rsp.toString()).append("\n\n");
        } catch (Exception e) {
            report.append("[Q] ").append(name).append(": ERRO ").append(e.getMessage()).append("\n\n");
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
                    }
                    // Habilita o botão Entrar e atualiza o label de status
                    updateLoginApiStatus("✓ Servidor encontrado: " + url, COLOR_GREEN, true);
                });
            }
        } catch (Exception ignored) {}
    }

    /**
     * Tenta restaurar sessão salva (token + URL persistidos). Se válido,
     * usuário fica no Welcome. Caso contrário, leva para a tela de login
     * como gate de entrada do app.
     */
    private void tryRestoreSessionOrGoToLogin() {
        android.content.SharedPreferences prefs = getSharedPreferences("vigiaescolar", MODE_PRIVATE);
        final String token = prefs.getString("api_token", "");
        if (token.isEmpty()) {
            openLoginPage();
            return;
        }
        // URL sempre hardcoded (API_BASE_URL). Validação em background:
        // GET /schools com Bearer; se 2xx, sessão OK
        final String url = API_BASE_URL;
        pool.execute(() -> {
            try {
                HttpURLConnection c = (HttpURLConnection) new URL(url + "/schools").openConnection();
                c.setRequestMethod("GET");
                c.setRequestProperty("Authorization", "Bearer " + token);
                c.setConnectTimeout(3000); c.setReadTimeout(4000);
                int code = c.getResponseCode();
                if (code >= 200 && code < 300) {
                    apiToken = token;
                    String raw = readStream(c.getInputStream()).trim();
                    JSONArray arr = raw.startsWith("[") ? new JSONArray(raw)
                            : new JSONObject(raw).optJSONArray("data");
                    if (arr == null) arr = new JSONArray();
                    final JSONArray finalArr = arr;
                    runOnUiThread(() -> {
                        // Pré-popula lista de escolas para o Register vir já pronto
                        if (schoolList != null) showSchools(finalArr);
                        // Mantém Welcome (default em buildUi)
                        // Sincroniza câmeras silenciosamente para sobreviver à reinstalação
                        syncCamerasFromServer(false);
                    });
                } else {
                    // Token expirado/inválido — limpa e força login
                    getSharedPreferences("vigiaescolar", MODE_PRIVATE).edit()
                        .remove("api_token").apply();
                    runOnUiThread(this::openLoginPage);
                }
            } catch (Exception e) {
                // Sem rede ou servidor fora — exige login novo
                runOnUiThread(this::openLoginPage);
            }
        });
    }

    /** Logout: limpa token e devolve para a tela de login. */
    private void signOutAndGoToLogin() {
        apiToken = null;
        selectedSchoolId = null;
        getSharedPreferences("vigiaescolar", MODE_PRIVATE).edit()
            .remove("api_token").apply();
        if (appPasswordInput != null) appPasswordInput.setText("");
        toast("Sessão encerrada");
        openLoginPage();
    }

    /**
     * Abre tela de login. URL do servidor é hardcoded em API_BASE_URL —
     * não há mais detecção LAN nem campo URL na UI.
     */
    private void openLoginPage() {
        // Se não houver token (gate inicial / logout), esconde o Voltar pois não há para onde voltar
        if (loginBackBtn != null) {
            boolean hasSession = apiToken != null && !apiToken.isEmpty();
            loginBackBtn.setVisibility(hasSession ? View.VISIBLE : View.GONE);
        }
        // Garante que o campo invisível sempre tem a URL oficial
        if (apiUrlInput != null) apiUrlInput.setText(API_BASE_URL);
        showStep(WIZ_LOGIN);
    }

    private void loginApi() {
        // URL é hardcoded — ignora o que estiver no input para evitar mismatch
        String url   = API_BASE_URL;
        String email = emailInput.getText().toString().trim();
        String pass  = appPasswordInput.getText().toString().trim();
        if (email.isEmpty() || pass.isEmpty()) { toast("Preencha e-mail e senha"); return; }
        // Garante que o input invisível tem a URL oficial
        if (apiUrlInput != null) apiUrlInput.setText(url);
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
                // Persiste sessão para o usuário não precisar logar a cada abertura
                getSharedPreferences("vigiaescolar", MODE_PRIVATE).edit()
                    .putString("api_url", url)
                    .putString("api_email", email)
                    .putString("api_token", token)
                    .apply();
                runOnUiThread(() -> {
                    setChip(statusApi, "Conectado ✓", COLOR_GREEN);
                    toast("Login realizado");
                    fetchSchools(url, token);
                    // Sincroniza câmeras já configuradas (silencioso na primeira vez)
                    syncCamerasFromServer(false);
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
        // URL é hardcoded (API_BASE_URL)
        String apiUrl   = API_BASE_URL;
        String schoolId = schoolInput.getText().toString().trim();
        String name     = cameraNameInput.getText().toString().trim();
        String loc      = cameraLocInput.getText().toString().trim();

        if (apiToken == null || apiToken.isEmpty()) { toast("Faça login primeiro"); return; }
        if (schoolId.isEmpty()) { toast("Selecione uma escola"); return; }
        if (name.isEmpty()) { toast("Informe o nome da câmera"); return; }

        // Usa o IP descoberto via DVRIP scan (preenchido por startCameraIpDiscovery)
        // OU o que o usuário digitou no fluxo legado. Senão, "DHCP" como placeholder.
        String ip;
        if (discoveredCameraIp != null && !discoveredCameraIp.isEmpty()) {
            ip = discoveredCameraIp;
        } else if (cameraIpInput != null && !cameraIpInput.getText().toString().trim().isEmpty()) {
            ip = cameraIpInput.getText().toString().trim();
        } else {
            ip = "DHCP";
        }

        final String finalIp  = ip;
        final String finalLoc = loc.isEmpty() ? "Configurada via APK" : loc;
        final String camPass = cameraPassInput.getText().toString().trim();

        // URL do stream cadastrada no painel: aponta para MediaMTX na VPS,
        // não para o IP local da câmera. A câmera (firmware OpenIPC) faz
        // RTMP push para a VPS e o MediaMTX republica em RTSP para o
        // face-server consumir. Stream key = serialNumber.
        // Fallback: se não temos SN ainda, registra com placeholder e a
        // câmera fica "pendente" até o backend receber a primeira publish.
        final String sn = connectedDevSn != null ? connectedDevSn.replaceAll("[^A-Za-z0-9_-]", "") : "";
        final String rtspUrl = sn.isEmpty()
            ? "rtsp://" + MEDIA_HOST + ":" + RTSP_PORT + "/live/PENDING_SN"
            : "rtsp://" + MEDIA_HOST + ":" + RTSP_PORT + "/live/" + sn;

        pool.execute(() -> {
            try {
                JSONObject payload = new JSONObject();
                payload.put("nome", name);
                payload.put("escolaId", schoolId);
                payload.put("localizacao", finalLoc);
                payload.put("tipo", "RTSP");
                payload.put("url", rtspUrl);
                payload.put("porta", RTSP_PORT);  // 8554 do MediaMTX
                payload.put("resolucao", "1080p");
                payload.put("fps", 30);
                payload.put("status", "Ativa");
                // Câmera com firmware OpenIPC não usa user/senha no stream
                // (auth fica embutida na URL RTMP publicada pela câmera).
                // Mantém o campo para compatibilidade com câmeras XM legadas.
                payload.put("usuario", "admin");
                payload.put("senha", camPass);
                // Identificadores físicos — permitem ressincronização após reinstalação
                if (selectedCameraMac != null && !selectedCameraMac.isEmpty()) {
                    payload.put("bluetoothMac", selectedCameraMac);
                }
                if (connectedDevSn != null && !connectedDevSn.isEmpty()) {
                    payload.put("serialNumber", connectedDevSn);
                }
                if (selectedWifiSsid != null && !selectedWifiSsid.isEmpty()) {
                    payload.put("wifiSsid", selectedWifiSsid);
                }

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

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != 70) return;
        boolean bleOk = true;
        for (int i = 0; i < permissions.length; i++) {
            String p = permissions[i];
            boolean granted = i < grantResults.length && grantResults[i] == PackageManager.PERMISSION_GRANTED;
            if (!granted && (p.equals(Manifest.permission.BLUETOOTH_SCAN)
                    || p.equals(Manifest.permission.BLUETOOTH_CONNECT)
                    || p.equals(Manifest.permission.ACCESS_FINE_LOCATION))) {
                bleOk = false;
            }
        }
        // Se o usuário está na tela de busca e concedeu agora, dispara o scan
        if (bleOk && currentStep == WIZ_FIND_CAMERA && !bleScanning) {
            logBle("✓ Permissões concedidas — iniciando busca");
            startBleScan();
        } else if (!bleOk && currentStep == WIZ_FIND_CAMERA) {
            setChip(statusBle, "Permissões negadas", Color.rgb(185, 28, 28));
            logBle("⚠ Algumas permissões foram negadas. Abra as configurações do app para conceder.");
        }
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
