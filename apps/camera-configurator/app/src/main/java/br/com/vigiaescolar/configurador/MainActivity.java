package br.com.vigiaescolar.configurador;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.text.InputType;
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
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * VigiaEscolar — Configurador de Câmera XM/iCSee
 *
 * Fluxo principal:
 *  1. Usuário conecta o celular no AP da câmera (rede IPCamera_XXXXXX, senha 1234567890)
 *  2. App faz login DVRIP na câmera (TCP 34567, protocolo XM binário)
 *  3. App lê o SerialNo e config atual da câmera
 *  4. App envia o SSID e senha da rede Wi-Fi da escola para a câmera
 *  5. App faz login na API do VigiaEscolar
 *  6. App cadastra a câmera com o perfil correto e escola selecionada
 *
 * Protocolo DVRIP (porta 34567):
 *  - Frame: 20 bytes header binário + body JSON
 *  - Header: HeadFlag(FF) + Ver(01) + Res(0000) + SessionID(4) + SeqNo(4) + Chn(1) + Res(3) + MsgID(2 LE) + BodyLen(4 LE)
 *  - Login: MsgID=1000, senha = MD5(uppercase) truncada em 8 chars
 *  - GetConfig: MsgID=1020, body={"Name":"NetWork.Wifi","SessionID":"0x..."}
 *  - SetConfig: MsgID=1040, body={"Name":"NetWork.Wifi","SessionID":"0x...","NetWork.Wifi":{...}}
 */
public class MainActivity extends Activity {

    // ─── Constantes de protocolo ───────────────────────────────────────────────

    private static final String XM_AP_IP       = "192.168.10.1";
    private static final String XM_AP_PASSWORD = "1234567890";
    private static final int    DVRIP_PORT     = 34567;
    private static final byte   DVRIP_MAGIC    = (byte) 0xFF;
    private static final int    MSG_LOGIN      = 1000;
    private static final int    MSG_LOGIN_RSP  = 1001;
    private static final int    MSG_GET_CFG    = 1020;
    private static final int    MSG_GET_CFG_RSP= 1021;
    private static final int    MSG_SET_CFG    = 1040;
    private static final int    MSG_SET_CFG_RSP= 1041;
    private static final int    MSG_LOGOUT     = 1002;
    private static final int    DVRIP_RET_OK   = 100;
    private static final int    CONNECT_TIMEOUT= 3000;
    private static final int    READ_TIMEOUT   = 6000;
    private static final int[]  API_PORTS      = {3001, 7003, 80, 8080};
    private static final int[]  SCAN_PORTS     = {34567, 554, 34571, 8554, 80};

    // ─── Cores (paleta VigiaEscolar institucional) ─────────────────────────────

    private static final int COLOR_BG      = Color.rgb(245, 247, 251);
    private static final int COLOR_CARD    = Color.WHITE;
    private static final int COLOR_TEXT    = Color.rgb(17, 24, 39);
    private static final int COLOR_MUTED   = Color.rgb(100, 116, 139);
    private static final int COLOR_BORDER  = Color.rgb(226, 232, 240);
    private static final int COLOR_GREEN   = Color.rgb(0, 138, 59);   // #008a3b
    private static final int COLOR_BLUE    = Color.rgb(18, 53, 90);   // #12355a
    private static final int COLOR_SUCCESS = Color.rgb(220, 252, 231);
    private static final int COLOR_ERROR   = Color.rgb(254, 226, 226);

    // ─── Estado interno ────────────────────────────────────────────────────────

    private final ExecutorService pool = Executors.newFixedThreadPool(32);
    private final AtomicInteger seqNo = new AtomicInteger(0);

    // Sessão DVRIP da câmera
    private volatile String dvripSessionId = null;
    private volatile String cameraSerialNo = null;
    private volatile String cameraIp       = null;

    // Sessão API VigiaEscolar
    private volatile String apiToken       = null;
    private volatile String selectedSchool = null;

    // Candidatos descobertos
    private final Map<String, List<Integer>> networkCandidates = new HashMap<>();

    // ─── Widgets principais ────────────────────────────────────────────────────

    private LinearLayout logCamera;
    private LinearLayout networkList;
    private LinearLayout apiList;
    private LinearLayout schoolList;

    // Campos câmera
    private EditText cameraIpInput;
    private EditText cameraUserInput;
    private EditText cameraPassInput;

    // Campos rede escola
    private EditText wifiSsidInput;
    private EditText wifiPassInput;

    // Campos API
    private EditText apiUrlInput;
    private EditText emailInput;
    private EditText appPasswordInput;
    private EditText cameraNameInput;
    private EditText cameraLocInput;
    private EditText schoolInput;

    // Status widgets
    private TextView statusCamera;
    private TextView statusApi;

    // ─── Lifecycle ────────────────────────────────────────────────────────────

    @Override
    protected void onCreate(Bundle bundle) {
        super.onCreate(bundle);
        requestNeededPermissions();
        buildUi();
        discoverApis();
    }

    @Override
    protected void onDestroy() {
        pool.shutdownNow();
        super.onDestroy();
    }

    // ─── UI ───────────────────────────────────────────────────────────────────

    @SuppressLint("SetTextI18n")
    private void buildUi() {
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setBackgroundColor(COLOR_BG);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(dp(16), dp(16), dp(16), dp(32));
        scroll.addView(root);

        // ── Header ──────────────────────────────────────────────────────────
        LinearLayout header = new LinearLayout(this);
        header.setOrientation(LinearLayout.VERTICAL);
        header.setPadding(dp(16), dp(14), dp(16), dp(14));
        header.setBackground(rounded(COLOR_BLUE, COLOR_BLUE, 12));
        LinearLayout.LayoutParams headerParams = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        headerParams.setMargins(0, 0, 0, dp(16));
        header.setLayoutParams(headerParams);

        TextView appTitle = new TextView(this);
        appTitle.setText("VigiaEscolar");
        appTitle.setTextSize(22);
        appTitle.setTextColor(Color.WHITE);
        appTitle.setTypeface(Typeface.DEFAULT_BOLD);
        header.addView(appTitle);

        TextView appSub = new TextView(this);
        appSub.setText("Configurador de Câmera XM / iCSee");
        appSub.setTextSize(13);
        appSub.setTextColor(Color.argb(200, 255, 255, 255));
        header.addView(appSub);
        root.addView(header);

        // ── PASSO 1: Conectar no AP da câmera ───────────────────────────────
        LinearLayout apCard = card();
        apCard.addView(step("1", "Conectar no AP da câmera"));
        apCard.addView(muted("Ligue a câmera. Ela cria uma rede Wi-Fi própria (ex: IPCamera_XXXXXX). Conecte o celular nessa rede antes de continuar. A senha padrão é " + XM_AP_PASSWORD + "."));
        apCard.addView(spaced(secondaryButton("Abrir configurações Wi-Fi", v -> openWifiSettings())));
        apCard.addView(spaced(primaryButton("Estou conectado — testar câmera em " + XM_AP_IP, v -> testCameraAp())));
        logCamera = listBox();
        apCard.addView(logCamera);
        root.addView(apCard);

        // ── PASSO 2: Rede Wi-Fi da escola ────────────────────────────────────
        LinearLayout wifiCard = card();
        wifiCard.addView(step("2", "Rede Wi-Fi da escola"));
        wifiCard.addView(muted("Informe a rede Wi-Fi que a câmera deve usar após ser configurada. É a rede da escola, não do celular."));
        wifiSsidInput = input("Nome da rede (SSID)", false);
        wifiPassInput = input("Senha da rede", true);
        wifiCard.addView(field("SSID da rede", wifiSsidInput));
        wifiCard.addView(field("Senha da rede", wifiPassInput));
        root.addView(wifiCard);

        // ── PASSO 3: Dados da câmera ─────────────────────────────────────────
        LinearLayout cameraCard = card();
        cameraCard.addView(step("3", "Câmera XM / iCSee"));
        cameraCard.addView(muted("IP e credenciais de acesso à câmera. No modo AP o IP padrão é " + XM_AP_IP + ". Usuário padrão iCSee: yura."));
        cameraIpInput   = input("IP da câmera", false);
        cameraUserInput = input("Usuário (padrão: yura)", false);
        cameraPassInput = input("Senha da câmera (padrão: vazio)", true);
        cameraIpInput.setText(XM_AP_IP);
        cameraUserInput.setText("yura");

        statusCamera = statusChip("Não conectada");
        cameraCard.addView(field("IP da câmera", cameraIpInput));
        cameraCard.addView(field("Usuário", cameraUserInput));
        cameraCard.addView(field("Senha", cameraPassInput));
        cameraCard.addView(spaced(statusCamera));
        cameraCard.addView(spaced(primaryButton("Conectar e ler câmera (DVRIP)", v -> loginCamera())));
        cameraCard.addView(spaced(secondaryButton("Buscar câmeras na rede local", v -> scanLan())));
        networkList = listBox();
        cameraCard.addView(networkList);
        root.addView(cameraCard);

        // ── PASSO 4: API VigiaEscolar ────────────────────────────────────────
        LinearLayout apiCard = card();
        apiCard.addView(step("4", "API VigiaEscolar"));
        apiCard.addView(muted("Entre com o mesmo e-mail e senha do painel web do VigiaEscolar. A API é detectada automaticamente na rede local."));
        apiUrlInput     = input("http://192.168.0.x:3001/api", false);
        emailInput      = input("email@escola.com", false);
        appPasswordInput = input("Senha do painel web", true);

        statusApi = statusChip("Não conectado");
        apiCard.addView(spaced(secondaryButton("Detectar API na rede", v -> discoverApis())));
        apiList = listBox();
        apiCard.addView(apiList);
        apiCard.addView(field("URL da API", apiUrlInput));
        apiCard.addView(field("E-mail", emailInput));
        apiCard.addView(field("Senha", appPasswordInput));
        apiCard.addView(spaced(statusApi));
        apiCard.addView(spaced(primaryButton("Entrar na API", v -> loginApi())));

        apiCard.addView(spaced(sectionLabel("Escola para vincular a câmera")));
        schoolList = listBox();
        apiCard.addView(schoolList);
        schoolInput = input("ID da escola selecionada", false);
        apiCard.addView(field("Escola (ID)", schoolInput));
        root.addView(apiCard);

        // ── PASSO 5: Cadastrar câmera ─────────────────────────────────────────
        LinearLayout finalCard = card();
        finalCard.addView(step("5", "Cadastrar câmera"));
        finalCard.addView(muted("Confirme os dados e cadastre a câmera no VigiaEscolar. O SerialNo será preenchido automaticamente após conectar."));
        cameraNameInput = input("Nome / identificação da câmera", false);
        cameraLocInput  = input("Localização (ex: Entrada principal)", false);
        cameraNameInput.setText("Câmera XM iCSee");
        finalCard.addView(field("Nome da câmera", cameraNameInput));
        finalCard.addView(field("Localização", cameraLocInput));
        finalCard.addView(spaced(muted("Antes de cadastrar, os passos 3 e 4 devem estar concluídos (câmera conectada + login na API).")));
        finalCard.addView(spaced(primaryButton("Enviar Wi-Fi para câmera e Cadastrar", v -> configureAndRegister())));
        root.addView(finalCard);

        setContentView(scroll);
    }

    // ─── Passo 1: AP da câmera ────────────────────────────────────────────────

    private void openWifiSettings() {
        startActivity(new Intent(Settings.ACTION_WIFI_SETTINGS));
    }

    private void testCameraAp() {
        appendCamera("Testando conexão com câmera em " + XM_AP_IP + "...");
        pool.execute(() -> {
            boolean open = isOpen(XM_AP_IP, DVRIP_PORT, 2000);
            runOnUiThread(() -> {
                if (open) {
                    cameraIpInput.setText(XM_AP_IP);
                    appendCamera("✓ Câmera respondeu na porta " + DVRIP_PORT + ". Toque em 'Conectar' no Passo 3.");
                } else {
                    appendCamera("✗ Câmera não respondeu em " + XM_AP_IP + ":" + DVRIP_PORT + ". Verifique se o celular está na rede AP da câmera.");
                }
            });
        });
    }

    // ─── Passo 3: Login DVRIP na câmera ──────────────────────────────────────

    private void loginCamera() {
        String ip   = cameraIpInput.getText().toString().trim();
        String user = cameraUserInput.getText().toString().trim();
        String pass = cameraPassInput.getText().toString().trim();

        if (ip.isEmpty()) { toast("Informe o IP da câmera"); return; }

        setStatusChip(statusCamera, "Conectando...", COLOR_BLUE);
        appendCamera("Conectando em " + ip + ":" + DVRIP_PORT + "...");
        pool.execute(() -> {
            try {
                dvripLogin(ip, user.isEmpty() ? "admin" : user, pass);
            } catch (Exception e) {
                runOnUiThread(() -> {
                    setStatusChip(statusCamera, "Erro: " + e.getMessage(), Color.rgb(185, 28, 28));
                    appendCamera("✗ Falha: " + e.getMessage());
                });
            }
        });
    }

    // ─── Passo 3: Descoberta LAN ──────────────────────────────────────────────

    private void scanLan() {
        networkCandidates.clear();
        networkList.removeAllViews();
        appendNetwork("Buscando câmeras na rede local...");
        pool.execute(() -> {
            List<String> ips = localSubnetIps();
            if (ips.isEmpty()) {
                runOnUiThread(() -> appendNetwork("Não foi possível identificar a rede Wi-Fi."));
                return;
            }
            for (String ip : ips) {
                pool.execute(() -> probeIp(ip));
            }
        });
    }

    private void probeIp(String ip) {
        List<Integer> open = new ArrayList<>();
        for (int port : SCAN_PORTS) {
            if (isOpen(ip, port, 500)) open.add(port);
        }
        if (!open.contains(34567) && !open.contains(554)) return;
        networkCandidates.put(ip, open);
        runOnUiThread(() -> {
            Button item = button(ip + "\nPortas: " + open, v -> {
                cameraIpInput.setText(ip);
                toast("IP preenchido: " + ip);
            });
            networkList.addView(item);
        });
    }

    // ─── Passo 4: API VigiaEscolar ────────────────────────────────────────────

    private void discoverApis() {
        if (apiList != null) {
            apiList.removeAllViews();
            appendApi("Buscando API do VigiaEscolar na rede local...");
        }
        pool.execute(() -> {
            List<String> ips = localSubnetIps();
            String local = wifiIp();
            if (local != null && !ips.contains(local)) ips.add(0, local);
            for (String ip : ips) {
                for (int port : API_PORTS) {
                    final String candidate = ip;
                    final int p = port;
                    pool.execute(() -> probeApi(candidate, p));
                }
            }
        });
    }

    private void probeApi(String ip, int port) {
        String url = "http://" + ip + ":" + port + "/api";
        if (!isVigiaApi(url)) return;
        runOnUiThread(() -> {
            Button item = button(url, v -> { apiUrlInput.setText(url); toast("API selecionada"); });
            apiList.addView(item);
            if (apiUrlInput.getText().toString().trim().isEmpty()) {
                apiUrlInput.setText(url);
                toast("API detectada: " + url);
            }
        });
    }

    private boolean isVigiaApi(String baseUrl) {
        try {
            HttpURLConnection c = (HttpURLConnection) new URL(baseUrl + "/health").openConnection();
            c.setRequestMethod("GET");
            c.setConnectTimeout(800);
            c.setReadTimeout(800);
            int code = c.getResponseCode();
            if (code < 200 || code >= 300) return false;
            return readStream(c.getInputStream()).contains("vigiaescolar-api");
        } catch (Exception ignored) { return false; }
    }

    private void loginApi() {
        String apiUrl = apiUrlInput.getText().toString().trim().replaceAll("/$", "");
        String email  = emailInput.getText().toString().trim();
        String pass   = appPasswordInput.getText().toString().trim();
        if (apiUrl.isEmpty() || email.isEmpty() || pass.isEmpty()) {
            toast("Preencha URL da API, e-mail e senha"); return;
        }
        setStatusChip(statusApi, "Entrando...", COLOR_BLUE);
        pool.execute(() -> {
            try {
                JSONObject payload = new JSONObject();
                payload.put("email", email);
                payload.put("password", pass);

                HttpURLConnection c = (HttpURLConnection) new URL(apiUrl + "/auth/login").openConnection();
                c.setRequestMethod("POST");
                c.setRequestProperty("Content-Type", "application/json");
                c.setRequestProperty("Accept", "application/json");
                c.setConnectTimeout(5000);
                c.setReadTimeout(8000);
                c.setDoOutput(true);
                c.getOutputStream().write(payload.toString().getBytes(StandardCharsets.UTF_8));

                int code = c.getResponseCode();
                if (code < 200 || code >= 300) {
                    final int fc = code;
                    runOnUiThread(() -> {
                        setStatusChip(statusApi, "Falha HTTP " + fc, Color.rgb(185, 28, 28));
                        toast("Login falhou: HTTP " + fc);
                    });
                    return;
                }

                JSONObject json = new JSONObject(readStream(c.getInputStream()));
                String token = findToken(json);
                if (token.isEmpty()) {
                    runOnUiThread(() -> {
                        setStatusChip(statusApi, "Token não encontrado", Color.rgb(185, 28, 28));
                        toast("Login feito, mas token não encontrado na resposta");
                    });
                    return;
                }
                apiToken = token;
                runOnUiThread(() -> {
                    setStatusChip(statusApi, "Conectado ✓", COLOR_GREEN);
                    toast("Login realizado");
                    fetchSchools(apiUrl, token);
                });
            } catch (Exception e) {
                runOnUiThread(() -> {
                    setStatusChip(statusApi, "Erro: " + e.getMessage(), Color.rgb(185, 28, 28));
                    toast("Erro no login: " + e.getMessage());
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
                c.setConnectTimeout(5000);
                c.setReadTimeout(8000);
                int code = c.getResponseCode();
                if (code < 200 || code >= 300) {
                    runOnUiThread(() -> toast("Não foi possível carregar escolas: HTTP " + code));
                    return;
                }
                String body = readStream(c.getInputStream());
                JSONArray schools = parseSchoolArray(body);
                runOnUiThread(() -> showSchools(schools));
            } catch (Exception e) {
                runOnUiThread(() -> toast("Erro ao carregar escolas: " + e.getMessage()));
            }
        });
    }

    private JSONArray parseSchoolArray(String body) throws Exception {
        // Pode ser array direto ou objeto com data/items
        body = body.trim();
        if (body.startsWith("[")) return new JSONArray(body);
        JSONObject obj = new JSONObject(body);
        for (String key : new String[]{"data", "items", "results", "records", "rows", "list", "schools"}) {
            JSONArray arr = obj.optJSONArray(key);
            if (arr != null) return arr;
        }
        return new JSONArray();
    }

    private void showSchools(JSONArray schools) {
        schoolList.removeAllViews();
        if (schools.length() == 0) {
            schoolList.addView(text("Nenhuma escola encontrada para este usuário."));
            return;
        }
        if (schools.length() == 1) {
            JSONObject s = schools.optJSONObject(0);
            if (s != null) {
                selectedSchool = s.optString("id", "");
                schoolInput.setText(selectedSchool);
                schoolList.addView(successChip("Escola selecionada: " + s.optString("nome", s.optString("name", "Escola"))));
            }
            return;
        }
        for (int i = 0; i < schools.length(); i++) {
            JSONObject s = schools.optJSONObject(i);
            if (s == null) continue;
            String id   = s.optString("id", "");
            String name = s.optString("nome", s.optString("name", "Escola"));
            schoolList.addView(button(name + "\n" + id, v -> {
                selectedSchool = id;
                schoolInput.setText(id);
                toast("Escola selecionada: " + name);
            }));
        }
    }

    // ─── Passo 5: Configurar e cadastrar ─────────────────────────────────────

    private void configureAndRegister() {
        String ip        = cameraIpInput.getText().toString().trim();
        String user      = cameraUserInput.getText().toString().trim();
        String pass      = cameraPassInput.getText().toString().trim();
        String ssid      = wifiSsidInput.getText().toString().trim();
        String wifiPass  = wifiPassInput.getText().toString().trim();
        String apiUrl    = apiUrlInput.getText().toString().trim().replaceAll("/$", "");
        String name      = cameraNameInput.getText().toString().trim();
        String loc       = cameraLocInput.getText().toString().trim();
        String schoolId  = schoolInput.getText().toString().trim();

        if (ip.isEmpty()) { toast("Informe o IP da câmera (Passo 3)"); return; }
        if (apiToken == null || apiToken.isEmpty()) { toast("Faça login na API primeiro (Passo 4)"); return; }
        if (schoolId.isEmpty()) { toast("Selecione uma escola (Passo 4)"); return; }
        if (name.isEmpty()) { toast("Informe o nome da câmera (Passo 5)"); return; }

        appendCamera("Iniciando configuração completa...");
        final String finalUser = user.isEmpty() ? "yura" : user;
        final String finalLoc  = loc.isEmpty() ? "Configurada via APK" : loc;

        pool.execute(() -> {
            try {
                // 1. Conectar DVRIP e obter SerialNo
                if (dvripSessionId == null || cameraSerialNo == null) {
                    runOnUiThread(() -> appendCamera("Conectando DVRIP em " + ip + "..."));
                    dvripLogin(ip, finalUser, pass);
                }

                String serial = cameraSerialNo != null ? cameraSerialNo : ip;

                // 2. Enviar Wi-Fi para a câmera (se SSID informado)
                if (!ssid.isEmpty()) {
                    runOnUiThread(() -> appendCamera("Enviando rede Wi-Fi '" + ssid + "' para a câmera..."));
                    dvripSetWifi(ip, finalUser, pass, ssid, wifiPass);
                    runOnUiThread(() -> appendCamera("✓ Wi-Fi enviado. A câmera irá reconectar em breve."));
                }

                // 3. Montar URL RTSP
                String rtspUrl = "rtsp://" + ip + ":554/user={username}_password={password}_channel=1_stream=0.sdp?real_stream";
                if (!ssid.isEmpty()) {
                    // Após configurar Wi-Fi, a câmera se conectará à rede da escola
                    runOnUiThread(() -> appendCamera("Nota: após reconectar ao Wi-Fi, descubra o novo IP pela rede da escola e atualize no painel."));
                }

                // 4. Cadastrar câmera na API
                runOnUiThread(() -> appendCamera("Cadastrando câmera na API do VigiaEscolar..."));
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
                payload.put("usuario", finalUser);
                payload.put("senha", pass);
                if (!serial.equals(ip)) payload.put("serialNo", serial);

                HttpURLConnection c = (HttpURLConnection) new URL(apiUrl + "/cameras").openConnection();
                c.setRequestMethod("POST");
                c.setRequestProperty("Content-Type", "application/json");
                c.setRequestProperty("Accept", "application/json");
                c.setRequestProperty("Authorization", "Bearer " + apiToken);
                c.setConnectTimeout(8000);
                c.setReadTimeout(8000);
                c.setDoOutput(true);
                c.getOutputStream().write(payload.toString().getBytes(StandardCharsets.UTF_8));

                int code = c.getResponseCode();
                if (code >= 200 && code < 300) {
                    String body = readStream(c.getInputStream());
                    runOnUiThread(() -> {
                        appendCamera("✓ Câmera cadastrada com sucesso!");
                        appendCamera("Serial: " + (cameraSerialNo != null ? cameraSerialNo : "N/A"));
                        toast("Câmera '" + name + "' cadastrada no VigiaEscolar");
                    });
                } else {
                    String errBody = "";
                    try { errBody = readStream(c.getErrorStream()); } catch (Exception ignored) {}
                    final String eb = errBody;
                    final int fc = code;
                    runOnUiThread(() -> {
                        appendCamera("✗ Falha ao cadastrar: HTTP " + fc + " — " + eb);
                        toast("Erro ao cadastrar câmera: HTTP " + fc);
                    });
                }

            } catch (Exception e) {
                runOnUiThread(() -> {
                    appendCamera("✗ Erro: " + e.getMessage());
                    toast("Erro: " + e.getMessage());
                });
            }
        });
    }

    // ─── Protocolo DVRIP ──────────────────────────────────────────────────────

    /**
     * Login DVRIP na câmera XM. Abre socket TCP na porta 34567, envia frame de login
     * com senha em MD5 truncada. Em caso de sucesso, armazena sessionId e serialNo.
     */
    private void dvripLogin(String ip, String user, String pass) throws Exception {
        cameraIp = ip;
        int seq = seqNo.getAndIncrement();

        // Monta payload de login
        JSONObject body = new JSONObject();
        body.put("EncryptType", "MD5");
        body.put("LoginType", "DVRIP-Web");
        body.put("PassWord", md5Hash(pass));
        body.put("UserName", user);
        body.put("SessionID", "0x0000000000");
        byte[] bodyBytes = body.toString().getBytes(StandardCharsets.UTF_8);

        try (Socket socket = new Socket()) {
            socket.connect(new InetSocketAddress(ip, DVRIP_PORT), CONNECT_TIMEOUT);
            socket.setSoTimeout(READ_TIMEOUT);

            // Envia frame de login
            sendDvripFrame(socket.getOutputStream(), 0, seq, MSG_LOGIN, bodyBytes);

            // Lê resposta
            JSONObject rsp = readDvripFrame(socket.getInputStream());
            int ret = rsp.optInt("Ret", -1);

            if (ret != DVRIP_RET_OK && ret != 101) {
                throw new Exception("Login rejeitado (Ret=" + ret + "). Verifique usuário e senha.");
            }

            String sessionId = rsp.optString("SessionID", "");
            if (sessionId.isEmpty()) throw new Exception("SessionID não retornado pela câmera.");

            dvripSessionId = sessionId;

            // Extrai SerialNo do SystemInfo que vem junto com o login
            JSONObject sysInfo = rsp.optJSONObject("SystemInfo");
            if (sysInfo != null) {
                cameraSerialNo = sysInfo.optString("SerialNo", null);
            }

            String sn = cameraSerialNo != null ? cameraSerialNo : "N/A";
            runOnUiThread(() -> {
                setStatusChip(statusCamera, "Conectada ✓  Serial: " + sn, COLOR_GREEN);
                appendCamera("✓ Login DVRIP: Session=" + sessionId + "  Serial=" + sn);
            });
        }
    }

    /**
     * Envia configuração de Wi-Fi para a câmera via protocolo DVRIP (SetConfig NetWork.Wifi).
     */
    private void dvripSetWifi(String ip, String user, String pass, String ssid, String wifiPass) throws Exception {
        // Garante sessão ativa
        if (dvripSessionId == null) dvripLogin(ip, user, pass);

        int seq = seqNo.getAndIncrement();

        // Determina o tipo de autenticação/criptografia
        String auth = wifiPass.isEmpty() ? "OPEN" : "WPA2";
        String enc  = wifiPass.isEmpty() ? "NONE" : "AES";

        JSONObject wifiCfg = new JSONObject();
        wifiCfg.put("Enable", true);
        wifiCfg.put("SSID", ssid);
        wifiCfg.put("Auth", auth);
        wifiCfg.put("EncrypType", enc);
        wifiCfg.put("KeyType", 0);
        wifiCfg.put("Keys", wifiPass);
        wifiCfg.put("NetType", "DHCP");
        wifiCfg.put("HostIP", "0.0.0.0");
        wifiCfg.put("GateWay", "0.0.0.0");
        wifiCfg.put("Submask", "0.0.0.0");

        JSONObject body = new JSONObject();
        body.put("Name", "NetWork.Wifi");
        body.put("SessionID", dvripSessionId);
        body.put("NetWork.Wifi", wifiCfg);
        byte[] bodyBytes = body.toString().getBytes(StandardCharsets.UTF_8);

        int sessionInt = parseSessionId(dvripSessionId);

        try (Socket socket = new Socket()) {
            socket.connect(new InetSocketAddress(ip, DVRIP_PORT), CONNECT_TIMEOUT);
            socket.setSoTimeout(READ_TIMEOUT);

            // Re-autenticar nessa conexão (cada socket é uma sessão nova no DVRIP)
            JSONObject loginBody = new JSONObject();
            loginBody.put("EncryptType", "MD5");
            loginBody.put("LoginType", "DVRIP-Web");
            loginBody.put("PassWord", md5Hash(pass));
            loginBody.put("UserName", user.isEmpty() ? "yura" : user);
            loginBody.put("SessionID", "0x0000000000");
            sendDvripFrame(socket.getOutputStream(), 0, seq, MSG_LOGIN, loginBody.toString().getBytes(StandardCharsets.UTF_8));
            JSONObject loginRsp = readDvripFrame(socket.getInputStream());

            String sid = loginRsp.optString("SessionID", dvripSessionId);
            int sessionIdInt = parseSessionId(sid);

            // Agora envia SetConfig
            body.put("SessionID", sid);
            bodyBytes = body.toString().getBytes(StandardCharsets.UTF_8);
            sendDvripFrame(socket.getOutputStream(), sessionIdInt, seqNo.getAndIncrement(), MSG_SET_CFG, bodyBytes);
            JSONObject rsp = readDvripFrame(socket.getInputStream());

            int ret = rsp.optInt("Ret", -1);
            if (ret != DVRIP_RET_OK) {
                throw new Exception("SetConfig Wi-Fi rejeitado (Ret=" + ret + ")");
            }
        }
    }

    /**
     * Envia um frame DVRIP.
     * Estrutura do header (20 bytes, little-endian):
     *   FF 01 00 00  [SessionID 4B LE]  [SeqNo 4B LE]  00 00 00 00  [MsgID 2B LE]  [BodyLen 4B LE]
     */
    private void sendDvripFrame(OutputStream out, int sessionId, int seq, int msgId, byte[] body) throws Exception {
        ByteBuffer header = ByteBuffer.allocate(20).order(ByteOrder.LITTLE_ENDIAN);
        header.put(DVRIP_MAGIC);   // 0xFF magic
        header.put((byte) 0x01);   // version
        header.put((byte) 0x00);   // reserved
        header.put((byte) 0x00);   // reserved
        header.putInt(sessionId);  // SessionID (4 bytes LE)
        header.putInt(seq);        // SequenceNo (4 bytes LE)
        header.put((byte) 0x00);   // Channel
        header.put((byte) 0x00);   // reserved
        header.put((byte) 0x00);   // reserved
        header.put((byte) 0x00);   // reserved
        header.putShort((short) msgId);       // MsgID (2 bytes LE)
        header.putInt(body.length + 2);       // BodyLen (+2 for \r\n that some firmware expects)
        out.write(header.array());
        out.write(body);
        out.write('\r');
        out.write('\n');
        out.flush();
    }

    /**
     * Lê um frame DVRIP da câmera. Retorna o body como JSONObject.
     */
    private JSONObject readDvripFrame(InputStream in) throws Exception {
        // Lê os 20 bytes de header
        byte[] hdr = readExact(in, 20);
        ByteBuffer buf = ByteBuffer.wrap(hdr).order(ByteOrder.LITTLE_ENDIAN);

        byte magic = buf.get();           // HeadFlag
        buf.get();                         // Version
        buf.getShort();                    // Reserved
        buf.getInt();                      // SessionID
        buf.getInt();                      // SeqNo
        buf.get();                         // Channel
        buf.get(); buf.get(); buf.get();   // Reserved x3
        buf.getShort();                    // MsgID
        int bodyLen = buf.getInt();        // BodyLen

        if (bodyLen < 0 || bodyLen > 65536) throw new Exception("Frame DVRIP inválido (bodyLen=" + bodyLen + ")");

        byte[] bodyBytes = readExact(in, bodyLen);
        // Remove trailing \r\n se houver
        int end = bodyLen;
        while (end > 0 && (bodyBytes[end - 1] == '\r' || bodyBytes[end - 1] == '\n' || bodyBytes[end - 1] == 0)) end--;
        String bodyStr = new String(bodyBytes, 0, end, StandardCharsets.UTF_8);

        return bodyStr.isEmpty() ? new JSONObject() : new JSONObject(bodyStr);
    }

    private byte[] readExact(InputStream in, int count) throws Exception {
        byte[] buf = new byte[count];
        int read = 0;
        while (read < count) {
            int r = in.read(buf, read, count - read);
            if (r < 0) throw new Exception("Conexão encerrada pela câmera (lido " + read + " de " + count + " bytes)");
            read += r;
        }
        return buf;
    }

    /** Converte "0x2c" ou "44" para int */
    private int parseSessionId(String sid) {
        try {
            sid = sid.trim();
            if (sid.startsWith("0x") || sid.startsWith("0X")) {
                return (int) Long.parseLong(sid.substring(2), 16);
            }
            return Integer.parseInt(sid);
        } catch (Exception ignored) { return 0; }
    }

    /**
     * Gera o hash MD5 da senha no formato que o DVRIP espera:
     * MD5 uppercase, cada byte como char de dois dígitos hexadecimais.
     * Firmware iCSee/XM usa apenas os primeiros 8 caracteres do hash hex como senha.
     */
    private String md5Hash(String input) {
        try {
            MessageDigest md = MessageDigest.getInstance("MD5");
            byte[] digest = md.digest(input.getBytes(StandardCharsets.UTF_8));
            StringBuilder hex = new StringBuilder();
            for (byte b : digest) hex.append(String.format("%02X", b));
            // XM DVRIP usa os 8 primeiros chars do hash MD5 uppercase
            String full = hex.toString();
            return full.length() >= 8 ? full.substring(0, 8) : full;
        } catch (Exception e) { return ""; }
    }

    // ─── Utilitários de rede ──────────────────────────────────────────────────

    private boolean isOpen(String ip, int port, int timeoutMs) {
        try (Socket s = new Socket()) {
            s.connect(new InetSocketAddress(ip, port), timeoutMs);
            return true;
        } catch (Exception ignored) { return false; }
    }

    private List<String> localSubnetIps() {
        String local = wifiIp();
        if (local == null) local = firstPrivateIpv4();
        if (local == null) return Collections.emptyList();
        String[] parts = local.split("\\.");
        if (parts.length != 4) return Collections.emptyList();
        String prefix = parts[0] + "." + parts[1] + "." + parts[2] + ".";
        List<String> list = new ArrayList<>();
        for (int i = 1; i <= 254; i++) {
            String ip = prefix + i;
            if (!ip.equals(local)) list.add(ip);
        }
        return list;
    }

    private String wifiIp() {
        WifiManager wifi = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
        if (wifi == null || wifi.getConnectionInfo() == null) return null;
        int v = wifi.getConnectionInfo().getIpAddress();
        if (v == 0) return null;
        return String.format(Locale.US, "%d.%d.%d.%d", v & 255, v >> 8 & 255, v >> 16 & 255, v >> 24 & 255);
    }

    private String firstPrivateIpv4() {
        try {
            for (NetworkInterface nif : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                for (java.net.InetAddress addr : Collections.list(nif.getInetAddresses())) {
                    String ip = addr.getHostAddress();
                    if (!addr.isLoopbackAddress() && ip != null &&
                        ip.matches("^(10\\.|192\\.168\\.|172\\.(1[6-9]|2\\d|3[0-1])\\.).*")) {
                        return ip;
                    }
                }
            }
        } catch (Exception ignored) {}
        return null;
    }

    private String readStream(InputStream in) throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[4096];
        int n;
        while ((n = in.read(buf)) >= 0) out.write(buf, 0, n);
        return out.toString("UTF-8");
    }

    private String findToken(JSONObject json) {
        for (String key : new String[]{"accessToken", "token", "jwt", "access_token"}) {
            String v = json.optString(key, "");
            if (!v.isEmpty()) return v;
        }
        JSONObject data = json.optJSONObject("data");
        if (data != null) return findToken(data);
        JSONObject session = json.optJSONObject("session");
        if (session != null) return findToken(session);
        return "";
    }

    // ─── Permissões ───────────────────────────────────────────────────────────

    private void requestNeededPermissions() {
        if (Build.VERSION.SDK_INT < 23) return;
        List<String> need = new ArrayList<>();
        need.add(Manifest.permission.ACCESS_FINE_LOCATION);
        need.add(Manifest.permission.ACCESS_WIFI_STATE);
        need.add(Manifest.permission.CHANGE_WIFI_STATE);
        if (Build.VERSION.SDK_INT >= 31) {
            need.add(Manifest.permission.BLUETOOTH_SCAN);
            need.add(Manifest.permission.BLUETOOTH_CONNECT);
        }
        List<String> missing = new ArrayList<>();
        for (String p : need) {
            if (checkSelfPermission(p) != PackageManager.PERMISSION_GRANTED) missing.add(p);
        }
        if (!missing.isEmpty()) requestPermissions(missing.toArray(new String[0]), 70);
    }

    // ─── Helpers de UI ────────────────────────────────────────────────────────

    private LinearLayout card() {
        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(dp(16), dp(16), dp(16), dp(16));
        card.setBackground(rounded(COLOR_CARD, COLOR_BORDER, 14));
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        p.setMargins(0, 0, 0, dp(14));
        card.setLayoutParams(p);
        return card;
    }

    private TextView step(String number, String label) {
        TextView v = new TextView(this);
        v.setText("Passo " + number + " — " + label);
        v.setTextSize(17);
        v.setTextColor(COLOR_BLUE);
        v.setTypeface(Typeface.DEFAULT_BOLD);
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        p.setMargins(0, 0, 0, dp(6));
        v.setLayoutParams(p);
        return v;
    }

    private TextView sectionLabel(String label) {
        TextView v = new TextView(this);
        v.setText(label);
        v.setTextSize(13);
        v.setTextColor(COLOR_MUTED);
        v.setTypeface(Typeface.DEFAULT_BOLD);
        return v;
    }

    private TextView text(String value) {
        TextView v = new TextView(this);
        v.setText(value);
        v.setTextSize(13);
        v.setTextColor(COLOR_TEXT);
        v.setLineSpacing(0, 1.1f);
        v.setPadding(0, dp(2), 0, dp(2));
        return v;
    }

    private TextView muted(String value) {
        TextView v = text(value);
        v.setTextColor(COLOR_MUTED);
        v.setPadding(0, dp(4), 0, dp(8));
        return v;
    }

    private TextView statusChip(String value) {
        TextView v = new TextView(this);
        v.setText(value);
        v.setTextSize(12);
        v.setTextColor(COLOR_MUTED);
        v.setTypeface(Typeface.DEFAULT_BOLD);
        v.setPadding(dp(10), dp(6), dp(10), dp(6));
        v.setBackground(rounded(COLOR_BG, COLOR_BORDER, 8));
        return v;
    }

    private View successChip(String value) {
        TextView v = new TextView(this);
        v.setText(value);
        v.setTextSize(13);
        v.setTextColor(COLOR_GREEN);
        v.setTypeface(Typeface.DEFAULT_BOLD);
        v.setPadding(dp(10), dp(8), dp(10), dp(8));
        v.setBackground(rounded(COLOR_SUCCESS, Color.rgb(134, 239, 172), 8));
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        p.setMargins(0, dp(6), 0, 0);
        v.setLayoutParams(p);
        return v;
    }

    private void setStatusChip(TextView chip, String text, int color) {
        chip.setText(text);
        chip.setTextColor(color);
        chip.setBackground(rounded(
            color == COLOR_GREEN ? COLOR_SUCCESS : color == COLOR_BLUE ? Color.rgb(219, 234, 254) : COLOR_ERROR,
            color == COLOR_GREEN ? Color.rgb(134, 239, 172) : color == COLOR_BLUE ? Color.rgb(147, 197, 253) : Color.rgb(252, 165, 165),
            8));
    }

    private EditText input(String hint, boolean password) {
        EditText e = new EditText(this);
        e.setHint(hint);
        e.setSingleLine(true);
        e.setInputType(password
            ? InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD
            : InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD);
        e.setTextColor(COLOR_TEXT);
        e.setHintTextColor(Color.rgb(148, 163, 184));
        e.setTextSize(14);
        e.setPadding(dp(12), 0, dp(12), 0);
        e.setBackground(rounded(COLOR_BG, COLOR_BORDER, 10));
        e.setMinHeight(dp(48));
        return e;
    }

    private LinearLayout field(String label, EditText input) {
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        p.setMargins(0, dp(8), 0, 0);
        box.setLayoutParams(p);

        TextView lbl = new TextView(this);
        lbl.setText(label);
        lbl.setTextSize(11);
        lbl.setTextColor(COLOR_MUTED);
        lbl.setTypeface(Typeface.DEFAULT_BOLD);
        lbl.setPadding(0, 0, 0, dp(4));
        box.addView(lbl);
        box.addView(input, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(48)));
        return box;
    }

    private Button button(String label, View.OnClickListener listener) {
        Button b = new Button(this);
        b.setText(label);
        b.setAllCaps(false);
        b.setTextColor(COLOR_TEXT);
        b.setTextSize(13);
        b.setGravity(android.view.Gravity.CENTER_VERTICAL | android.view.Gravity.START);
        b.setPadding(dp(12), dp(8), dp(12), dp(8));
        b.setBackground(rounded(Color.rgb(248, 250, 252), COLOR_BORDER, 10));
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        p.setMargins(0, dp(4), 0, 0);
        b.setLayoutParams(p);
        b.setOnClickListener(listener);
        return b;
    }

    private Button primaryButton(String label, View.OnClickListener listener) {
        Button b = button(label, listener);
        b.setTextColor(Color.WHITE);
        b.setGravity(android.view.Gravity.CENTER);
        b.setTypeface(Typeface.DEFAULT_BOLD);
        b.setBackground(rounded(COLOR_GREEN, COLOR_GREEN, 10));
        return b;
    }

    private Button secondaryButton(String label, View.OnClickListener listener) {
        Button b = button(label, listener);
        b.setTextColor(COLOR_BLUE);
        b.setGravity(android.view.Gravity.CENTER);
        b.setTypeface(Typeface.DEFAULT_BOLD);
        b.setBackground(rounded(Color.rgb(219, 234, 254), Color.rgb(147, 197, 253), 10));
        return b;
    }

    private View spaced(View v) {
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        p.setMargins(0, dp(10), 0, 0);
        v.setLayoutParams(p);
        return v;
    }

    private LinearLayout listBox() {
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setPadding(0, dp(4), 0, 0);
        return box;
    }

    private GradientDrawable rounded(int fill, int stroke, int radiusDp) {
        GradientDrawable d = new GradientDrawable();
        d.setColor(fill);
        d.setCornerRadius(dp(radiusDp));
        d.setStroke(dp(1), stroke);
        return d;
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }

    private void appendCamera(String msg) { logCamera.addView(text(msg)); }
    private void appendNetwork(String msg) { networkList.addView(text(msg)); }
    private void appendApi(String msg) { if (apiList != null) apiList.addView(text(msg)); }

    private void toast(String msg) {
        Toast.makeText(this, msg, Toast.LENGTH_LONG).show();
    }
}
