package br.com.vigiaescolar.configurador;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothGatt;
import android.bluetooth.BluetoothGattCallback;
import android.bluetooth.BluetoothGattCharacteristic;
import android.bluetooth.BluetoothGattService;
import android.bluetooth.BluetoothManager;
import android.bluetooth.le.BluetoothLeScanner;
import android.bluetooth.le.ScanCallback;
import android.bluetooth.le.ScanResult;
import android.content.Context;
import android.content.pm.PackageManager;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.Bundle;
import android.text.InputType;
import android.view.View;
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
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class MainActivity extends Activity {
    private static final int REQ_PERMISSIONS = 70;
    private static final int[] CAMERA_PORTS = {554, 34567, 80, 8080, 8899, 8554};
    private static final int[] API_PORTS = {3001, 7003, 80, 8080};

    private final ExecutorService pool = Executors.newFixedThreadPool(48);
    private final Set<String> bleAddresses = new HashSet<>();
    private final Set<String> apiCandidates = new HashSet<>();
    private final Map<String, List<Integer>> networkCandidates = new HashMap<>();

    private LinearLayout logList;
    private LinearLayout networkList;
    private LinearLayout apiList;
    private LinearLayout schoolList;
    private EditText apiUrlInput;
    private EditText emailInput;
    private EditText appPasswordInput;
    private EditText tokenInput;
    private EditText schoolInput;
    private EditText nameInput;
    private EditText ipInput;
    private EditText usernameInput;
    private EditText passwordInput;
    private Button bleButton;

    private BluetoothLeScanner scanner;
    private boolean bleScanning = false;

    private final ScanCallback scanCallback = new ScanCallback() {
        @Override
        public void onScanResult(int callbackType, ScanResult result) {
            BluetoothDevice device = result.getDevice();
            String address = device.getAddress();
            if (!bleAddresses.add(address)) return;

            String name = safeDeviceName(device);
            runOnUiThread(() -> addBleDevice(name, address, result.getRssi()));
        }
    };

    @Override
    protected void onCreate(Bundle bundle) {
        super.onCreate(bundle);
        requestNeededPermissions();
        buildUi();
        initBluetooth();
        discoverApis();
    }

    @Override
    protected void onDestroy() {
        stopBleScan();
        pool.shutdownNow();
        super.onDestroy();
    }

    private void buildUi() {
        ScrollView scroll = new ScrollView(this);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(28, 28, 28, 28);
        scroll.addView(root);

        TextView title = title("Vigia Config Camera");
        root.addView(title);
        root.addView(text("Use este app para descobrir a camera por Bluetooth ou rede local e cadastrar no Vigia Escolar."));

        root.addView(section("1. Bluetooth"));
        bleButton = button("Buscar dispositivos BLE", v -> toggleBleScan());
        root.addView(bleButton);
        logList = listBox();
        root.addView(logList);

        root.addView(section("2. Rede local"));
        root.addView(button("Buscar cameras na rede Wi-Fi", v -> scanLan()));
        networkList = listBox();
        root.addView(networkList);

        root.addView(section("3. Cadastro no Vigia Escolar"));
        root.addView(text("A API sera identificada automaticamente na rede local. Use o campo abaixo apenas se precisar corrigir manualmente."));
        root.addView(button("Encontrar API do Vigia Escolar", v -> discoverApis()));
        apiList = listBox();
        root.addView(apiList);

        apiUrlInput = input("API detectada. Ex: http://192.168.0.104:3001/api", false);
        emailInput = input("E-mail do usuario Vigia Escolar", false);
        appPasswordInput = input("Senha do usuario Vigia Escolar", true);
        tokenInput = input("Token Bearer preenchido pelo login", true);
        schoolInput = input("ID da escola", false);
        nameInput = input("Nome da camera", false);
        ipInput = input("IP da camera", false);
        usernameInput = input("Usuario da camera", false);
        passwordInput = input("Senha da camera", true);
        usernameInput.setText("yura");
        nameInput.setText("Camera encontrada");

        root.addView(apiUrlInput);
        root.addView(emailInput);
        root.addView(appPasswordInput);
        root.addView(button("Entrar na API", v -> loginApi()));
        root.addView(tokenInput);
        root.addView(text("Depois do login, selecione a escola encontrada ou deixe o app preencher automaticamente quando houver apenas uma."));
        schoolList = listBox();
        root.addView(schoolList);
        root.addView(schoolInput);
        root.addView(nameInput);
        root.addView(ipInput);
        root.addView(usernameInput);
        root.addView(passwordInput);
        root.addView(button("Cadastrar camera H264DVR / XM / iCSee", v -> registerCamera()));

        setContentView(scroll);
    }

    private void initBluetooth() {
        BluetoothManager manager = (BluetoothManager) getSystemService(Context.BLUETOOTH_SERVICE);
        BluetoothAdapter adapter = manager != null ? manager.getAdapter() : null;
        scanner = adapter != null ? adapter.getBluetoothLeScanner() : null;
        if (scanner == null) appendLog("Bluetooth LE indisponivel neste aparelho.");
    }

    @SuppressLint("MissingPermission")
    private void toggleBleScan() {
        if (scanner == null) {
            toast("Bluetooth LE indisponivel");
            return;
        }

        if (bleScanning) {
            stopBleScan();
            return;
        }

        bleAddresses.clear();
        logList.removeAllViews();
        appendLog("Escaneando BLE...");
        bleScanning = true;
        bleButton.setText("Parar busca BLE");
        scanner.startScan(scanCallback);
    }

    @SuppressLint("MissingPermission")
    private void stopBleScan() {
        if (scanner != null && bleScanning) scanner.stopScan(scanCallback);
        bleScanning = false;
        if (bleButton != null) bleButton.setText("Buscar dispositivos BLE");
    }

    @SuppressLint("MissingPermission")
    private void addBleDevice(String name, String address, int rssi) {
        Button item = button(String.format(Locale.US, "%s\n%s  RSSI %d", name, address, rssi), v -> inspectBleDevice(address));
        logList.addView(item);
    }

    @SuppressLint("MissingPermission")
    private void inspectBleDevice(String address) {
        BluetoothManager manager = (BluetoothManager) getSystemService(Context.BLUETOOTH_SERVICE);
        BluetoothAdapter adapter = manager != null ? manager.getAdapter() : null;
        if (adapter == null) return;

        appendLog("Conectando em " + address + " para listar services...");
        BluetoothDevice device = adapter.getRemoteDevice(address);
        device.connectGatt(this, false, new BluetoothGattCallback() {
            @Override
            public void onConnectionStateChange(BluetoothGatt gatt, int status, int newState) {
                if (newState == android.bluetooth.BluetoothProfile.STATE_CONNECTED) {
                    gatt.discoverServices();
                } else {
                    gatt.close();
                }
            }

            @Override
            public void onServicesDiscovered(BluetoothGatt gatt, int status) {
                StringBuilder builder = new StringBuilder();
                builder.append("Services BLE de ").append(address).append("\n");
                for (BluetoothGattService service : gatt.getServices()) {
                    builder.append("SVC ").append(service.getUuid()).append("\n");
                    for (BluetoothGattCharacteristic characteristic : service.getCharacteristics()) {
                        builder.append("  CHR ").append(characteristic.getUuid())
                            .append(" props=").append(characteristic.getProperties()).append("\n");
                    }
                }
                gatt.close();
                runOnUiThread(() -> appendLog(builder.toString()));
            }
        });
    }

    private void scanLan() {
        networkCandidates.clear();
        networkList.removeAllViews();
        appendNetwork("Buscando cameras na rede local...");

        pool.execute(() -> {
            List<String> ips = localSubnetIps();
            if (ips.isEmpty()) {
                runOnUiThread(() -> appendNetwork("Nao foi possivel identificar a rede Wi-Fi local."));
                return;
            }

            for (String ip : ips) {
                pool.execute(() -> probeIp(ip));
            }
        });
    }

    private void discoverApis() {
        apiCandidates.clear();
        if (apiList != null) {
            apiList.removeAllViews();
            appendApi("Buscando API do Vigia Escolar na rede local...");
        }

        pool.execute(() -> {
            List<String> ips = localSubnetIps();
            if (ips.isEmpty()) {
                runOnUiThread(() -> appendApi("Nao foi possivel identificar a rede local."));
                return;
            }

            String localIp = wifiIp();
            if (localIp != null) ips.add(0, localIp);

            for (String ip : ips) {
                for (int port : API_PORTS) {
                    pool.execute(() -> probeApi(ip, port));
                }
            }
        });
    }

    private void probeApi(String ip, int port) {
        String baseUrl = "http://" + ip + ":" + port + "/api";
        if (!isVigiaApi(baseUrl)) return;
        if (!apiCandidates.add(baseUrl)) return;

        runOnUiThread(() -> {
            addApiCandidate(baseUrl);
            if (trim(apiUrlInput).isEmpty()) {
                apiUrlInput.setText(baseUrl);
                toast("API detectada: " + baseUrl);
            }
        });
    }

    private boolean isVigiaApi(String baseUrl) {
        try {
            HttpURLConnection conn = (HttpURLConnection) new URL(baseUrl + "/health").openConnection();
            conn.setRequestMethod("GET");
            conn.setConnectTimeout(850);
            conn.setReadTimeout(850);
            conn.setRequestProperty("Accept", "application/json");
            int code = conn.getResponseCode();
            if (code < 200 || code >= 300) return false;
            String body = readStream(conn.getInputStream());
            return body.contains("vigiaescolar-api");
        } catch (Exception ignored) {
            return false;
        }
    }

    private void addApiCandidate(String baseUrl) {
        Button item = button(baseUrl, v -> {
            apiUrlInput.setText(baseUrl);
            toast("API selecionada");
        });
        apiList.addView(item);
    }

    private void probeIp(String ip) {
        List<Integer> open = new ArrayList<>();
        for (int port : CAMERA_PORTS) {
            if (isOpen(ip, port, 650)) open.add(port);
        }
        if (open.isEmpty()) return;

        boolean likelyCamera = open.contains(554) || open.contains(34567) || open.contains(8554);
        if (!likelyCamera) return;

        networkCandidates.put(ip, open);
        runOnUiThread(() -> addNetworkCandidate(ip, open));
    }

    private boolean isOpen(String ip, int port, int timeoutMs) {
        try (Socket socket = new Socket()) {
            socket.connect(new InetSocketAddress(ip, port), timeoutMs);
            return true;
        } catch (Exception ignored) {
            return false;
        }
    }

    private List<String> localSubnetIps() {
        String localIp = wifiIp();
        if (localIp == null) localIp = firstPrivateIpv4();
        if (localIp == null) return Collections.emptyList();

        String[] parts = localIp.split("\\.");
        if (parts.length != 4) return Collections.emptyList();
        String prefix = parts[0] + "." + parts[1] + "." + parts[2] + ".";
        List<String> ips = new ArrayList<>();
        for (int i = 1; i <= 254; i++) {
            String ip = prefix + i;
            if (!ip.equals(localIp)) ips.add(ip);
        }
        return ips;
    }

    private String wifiIp() {
        WifiManager wifi = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
        if (wifi == null || wifi.getConnectionInfo() == null) return null;
        int value = wifi.getConnectionInfo().getIpAddress();
        if (value == 0) return null;
        return String.format(Locale.US, "%d.%d.%d.%d", value & 255, value >> 8 & 255, value >> 16 & 255, value >> 24 & 255);
    }

    private String firstPrivateIpv4() {
        try {
            for (NetworkInterface nif : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                for (java.net.InetAddress addr : Collections.list(nif.getInetAddresses())) {
                    String ip = addr.getHostAddress();
                    if (!addr.isLoopbackAddress() && ip.matches("^(10\\.|192\\.168\\.|172\\.(1[6-9]|2\\d|3[0-1])\\.).*")) {
                        return ip;
                    }
                }
            }
        } catch (Exception ignored) {
        }
        return null;
    }

    private void addNetworkCandidate(String ip, List<Integer> ports) {
        Button item = button(ip + "\nPortas: " + ports, v -> {
            ipInput.setText(ip);
            if (ports.contains(34567)) usernameInput.setText("yura");
            toast("IP preenchido: " + ip);
        });
        networkList.addView(item);
    }

    private void registerCamera() {
        String apiUrl = trim(apiUrlInput).replaceAll("/$", "");
        String token = trim(tokenInput);
        String schoolId = trim(schoolInput);
        String name = trim(nameInput);
        String ip = trim(ipInput);
        String username = trim(usernameInput);
        String password = trim(passwordInput);

        if (apiUrl.isEmpty() || token.isEmpty() || schoolId.isEmpty() || name.isEmpty() || ip.isEmpty() || username.isEmpty() || password.isEmpty()) {
            toast("Preencha API, token, escola, nome, IP, usuario e senha");
            return;
        }

        pool.execute(() -> {
            try {
                JSONObject payload = new JSONObject();
                payload.put("nome", name);
                payload.put("escolaId", schoolId);
                payload.put("localizacao", "Configurada pelo APK");
                payload.put("tipo", "RTSP");
                payload.put("url", "rtsp://" + ip + ":554/user={username}_password={password}_channel=1_stream=0.sdp?real_stream");
                payload.put("porta", 554);
                payload.put("resolucao", "1080p");
                payload.put("fps", 30);
                payload.put("status", "Ativa");
                payload.put("usuario", username);
                payload.put("senha", password);

                HttpURLConnection conn = (HttpURLConnection) new URL(apiUrl + "/cameras").openConnection();
                conn.setRequestMethod("POST");
                conn.setRequestProperty("Accept", "application/json");
                conn.setRequestProperty("Content-Type", "application/json");
                conn.setRequestProperty("Authorization", "Bearer " + token);
                conn.setDoOutput(true);
                try (OutputStream out = conn.getOutputStream()) {
                    out.write(payload.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8));
                }

                int code = conn.getResponseCode();
                runOnUiThread(() -> toast(code >= 200 && code < 300 ? "Camera cadastrada" : "Falha ao cadastrar: HTTP " + code));
            } catch (Exception error) {
                runOnUiThread(() -> toast("Erro: " + error.getMessage()));
            }
        });
    }

    private void loginApi() {
        String apiUrl = trim(apiUrlInput).replaceAll("/$", "");
        String email = trim(emailInput);
        String password = trim(appPasswordInput);

        if (apiUrl.isEmpty()) {
            toast("API ainda nao detectada. Toque em Encontrar API e tente novamente.");
            discoverApis();
            return;
        }

        if (email.isEmpty() || password.isEmpty()) {
            toast("Preencha e-mail e senha da aplicacao");
            return;
        }

        pool.execute(() -> {
            try {
                JSONObject payload = new JSONObject();
                payload.put("email", email);
                payload.put("password", password);

                HttpURLConnection conn = (HttpURLConnection) new URL(apiUrl + "/auth/login").openConnection();
                conn.setRequestMethod("POST");
                conn.setRequestProperty("Accept", "application/json");
                conn.setRequestProperty("Content-Type", "application/json");
                conn.setDoOutput(true);
                try (OutputStream out = conn.getOutputStream()) {
                    out.write(payload.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8));
                }

                int code = conn.getResponseCode();
                if (code < 200 || code >= 300) {
                    runOnUiThread(() -> toast("Login falhou: HTTP " + code));
                    return;
                }

                String body = readStream(conn.getInputStream());
                JSONObject json = new JSONObject(body);
                String token = findToken(json);
                runOnUiThread(() -> {
                    if (token.isEmpty()) {
                        toast("Login feito, mas token nao foi encontrado na resposta");
                    } else {
                        tokenInput.setText(token);
                        toast("Login realizado");
                        fetchSchools(apiUrl, token);
                    }
                });
            } catch (Exception error) {
                runOnUiThread(() -> toast("Erro no login: " + error.getMessage()));
            }
        });
    }

    private void fetchSchools(String apiUrl, String token) {
        pool.execute(() -> {
            try {
                HttpURLConnection conn = (HttpURLConnection) new URL(apiUrl + "/schools").openConnection();
                conn.setRequestMethod("GET");
                conn.setRequestProperty("Accept", "application/json");
                conn.setRequestProperty("Authorization", "Bearer " + token);
                int code = conn.getResponseCode();
                if (code < 200 || code >= 300) {
                    runOnUiThread(() -> toast("Nao foi possivel carregar escolas: HTTP " + code));
                    return;
                }

                JSONArray schools = findArray(new JSONObject("{\"root\":" + readStream(conn.getInputStream()) + "}"), "root");
                runOnUiThread(() -> showSchools(schools));
            } catch (Exception error) {
                runOnUiThread(() -> toast("Erro ao carregar escolas: " + error.getMessage()));
            }
        });
    }

    private JSONArray findArray(JSONObject json, String preferredKey) {
        JSONArray direct = json.optJSONArray(preferredKey);
        if (direct != null) return direct;

        for (String key : new String[]{"data", "items", "results", "records", "rows", "list"}) {
            JSONArray array = json.optJSONArray(key);
            if (array != null) return array;
            JSONObject nested = json.optJSONObject(key);
            if (nested != null) {
                JSONArray nestedArray = findArray(nested, "");
                if (nestedArray != null) return nestedArray;
            }
        }

        return new JSONArray();
    }

    private void showSchools(JSONArray schools) {
        schoolList.removeAllViews();
        if (schools.length() == 0) {
            schoolList.addView(text("Nenhuma escola retornada para este usuario."));
            return;
        }

        if (schools.length() == 1) {
            JSONObject school = schools.optJSONObject(0);
            if (school != null) {
                schoolInput.setText(school.optString("id", ""));
                schoolList.addView(text("Escola selecionada: " + school.optString("nome", school.optString("name", "Escola"))));
            }
            return;
        }

        for (int i = 0; i < schools.length(); i++) {
            JSONObject school = schools.optJSONObject(i);
            if (school == null) continue;
            String id = school.optString("id", "");
            String name = school.optString("nome", school.optString("name", "Escola"));
            schoolList.addView(button(name + "\n" + id, v -> {
                schoolInput.setText(id);
                toast("Escola selecionada: " + name);
            }));
        }
    }

    private String findToken(JSONObject json) {
        for (String key : new String[]{"accessToken", "token", "jwt"}) {
            String value = json.optString(key, "");
            if (!value.isEmpty()) return value;
        }

        JSONObject data = json.optJSONObject("data");
        if (data != null) return findToken(data);
        JSONObject session = json.optJSONObject("session");
        if (session != null) return findToken(session);
        return "";
    }

    private String readStream(InputStream input) throws java.io.IOException {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        byte[] buffer = new byte[4096];
        int read;
        while ((read = input.read(buffer)) >= 0) {
            output.write(buffer, 0, read);
        }
        return output.toString("UTF-8");
    }

    private void requestNeededPermissions() {
        if (Build.VERSION.SDK_INT < 23) return;
        List<String> permissions = new ArrayList<>();
        permissions.add(Manifest.permission.ACCESS_FINE_LOCATION);
        if (Build.VERSION.SDK_INT >= 31) {
            permissions.add(Manifest.permission.BLUETOOTH_SCAN);
            permissions.add(Manifest.permission.BLUETOOTH_CONNECT);
        }

        List<String> missing = new ArrayList<>();
        for (String permission : permissions) {
            if (checkSelfPermission(permission) != PackageManager.PERMISSION_GRANTED) missing.add(permission);
        }
        if (!missing.isEmpty()) requestPermissions(missing.toArray(new String[0]), REQ_PERMISSIONS);
    }

    @SuppressLint("MissingPermission")
    private String safeDeviceName(BluetoothDevice device) {
        String name = device.getName();
        return name == null || name.trim().isEmpty() ? "BLE sem nome" : name;
    }

    private EditText input(String hint, boolean password) {
        EditText input = new EditText(this);
        input.setHint(hint);
        input.setSingleLine(true);
        input.setInputType(password ? InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD : InputType.TYPE_CLASS_TEXT);
        input.setPadding(12, 10, 12, 10);
        return input;
    }

    private Button button(String label, View.OnClickListener listener) {
        Button button = new Button(this);
        button.setText(label);
        button.setAllCaps(false);
        button.setOnClickListener(listener);
        return button;
    }

    private LinearLayout listBox() {
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        return box;
    }

    private TextView title(String value) {
        TextView view = text(value);
        view.setTextSize(24);
        view.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
        return view;
    }

    private TextView section(String value) {
        TextView view = text(value);
        view.setTextSize(18);
        view.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
        view.setPadding(0, 28, 0, 8);
        return view;
    }

    private TextView text(String value) {
        TextView view = new TextView(this);
        view.setText(value);
        view.setTextSize(14);
        view.setPadding(0, 6, 0, 6);
        return view;
    }

    private void appendLog(String message) {
        logList.addView(text(message));
    }

    private void appendNetwork(String message) {
        networkList.addView(text(message));
    }

    private void appendApi(String message) {
        if (apiList != null) apiList.addView(text(message));
    }

    private String trim(EditText input) {
        return input.getText().toString().trim();
    }

    private void toast(String message) {
        Toast.makeText(this, message, Toast.LENGTH_LONG).show();
    }
}
