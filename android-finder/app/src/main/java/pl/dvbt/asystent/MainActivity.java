package pl.dvbt.asystent;

import android.Manifest;
import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.net.Uri;
import android.os.Bundle;
import android.os.Looper;
import android.provider.Settings;
import android.view.Surface;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.util.List;
import java.util.Locale;

public class MainActivity extends Activity implements SensorEventListener {
    private static final int LOCATION_REQUEST = 42;

    private WebView webView;
    private LocationManager locationManager;
    private SensorManager sensorManager;
    private Sensor rotationSensor;
    private boolean compassRunning = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        locationManager = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
        sensorManager = (SensorManager) getSystemService(Context.SENSOR_SERVICE);
        rotationSensor = sensorManager.getDefaultSensor(Sensor.TYPE_ROTATION_VECTOR);

        webView = new WebView(this);
        setContentView(webView);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);

        webView.setWebViewClient(new WebViewClient());
        webView.setWebChromeClient(new WebChromeClient());
        webView.addJavascriptInterface(new NativeBridge(), "Android");
        webView.loadUrl("file:///android_asset/index.html");
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (compassRunning) registerCompass();
    }

    @Override
    protected void onPause() {
        sensorManager.unregisterListener(this);
        super.onPause();
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    private class NativeBridge {
        @JavascriptInterface
        public void requestLocation() {
            runOnUiThread(() -> ensureLocation());
        }

        @JavascriptInterface
        public void startCompass() {
            runOnUiThread(() -> {
                compassRunning = true;
                registerCompass();
                if (rotationSensor == null) {
                    sendJs("window.onCompassUnavailable && window.onCompassUnavailable()");
                }
            });
        }

        @JavascriptInterface
        public void stopCompass() {
            runOnUiThread(() -> {
                compassRunning = false;
                sensorManager.unregisterListener(MainActivity.this);
            });
        }

        @JavascriptInterface
        public void openMap(double lat, double lon, String label) {
            runOnUiThread(() -> {
                String query = String.format(Locale.US, "geo:%f,%f?q=%f,%f(%s)", lat, lon, lat, lon, Uri.encode(label == null ? "Nadajnik DVB-T" : label));
                Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(query));
                try {
                    startActivity(intent);
                } catch (Exception ex) {
                    openUrl("https://www.openstreetmap.org/?mlat=" + lat + "&mlon=" + lon + "#map=14/" + lat + "/" + lon);
                }
            });
        }

        @JavascriptInterface
        public void openUrl(String url) {
            runOnUiThread(() -> MainActivity.this.openUrl(url));
        }

        @JavascriptInterface
        public void openLocationSettings() {
            runOnUiThread(() -> startActivity(new Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS)));
        }
    }

    private void openUrl(String url) {
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            startActivity(intent);
        } catch (Exception ignored) {
        }
    }

    private void registerCompass() {
        if (rotationSensor != null) {
            sensorManager.unregisterListener(this);
            sensorManager.registerListener(this, rotationSensor, SensorManager.SENSOR_DELAY_UI);
        }
    }

    private void ensureLocation() {
        if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED &&
                checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{
                    Manifest.permission.ACCESS_FINE_LOCATION,
                    Manifest.permission.ACCESS_COARSE_LOCATION
            }, LOCATION_REQUEST);
            return;
        }
        obtainLocation();
    }

    private void obtainLocation() {
        if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED &&
                checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            sendLocationError("Brak uprawnienia do lokalizacji");
            return;
        }

        Location best = null;
        try {
            List<String> providers = locationManager.getProviders(true);
            for (String provider : providers) {
                Location candidate = locationManager.getLastKnownLocation(provider);
                if (candidate != null && (best == null || candidate.getAccuracy() < best.getAccuracy())) {
                    best = candidate;
                }
            }
        } catch (Exception ignored) {
        }

        if (best != null) {
            sendLocation(best);
        }

        LocationListener listener = new LocationListener() {
            @Override
            public void onLocationChanged(Location location) {
                sendLocation(location);
            }
        };

        boolean requested = false;
        try {
            if (locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
                locationManager.requestSingleUpdate(LocationManager.GPS_PROVIDER, listener, Looper.getMainLooper());
                requested = true;
            }
        } catch (Exception ignored) {
        }

        if (!requested) {
            try {
                if (locationManager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) {
                    locationManager.requestSingleUpdate(LocationManager.NETWORK_PROVIDER, listener, Looper.getMainLooper());
                    requested = true;
                }
            } catch (Exception ignored) {
            }
        }

        if (!requested && best == null) {
            sendLocationError("Włącz lokalizację w telefonie");
        }
    }

    private void sendLocation(Location location) {
        final double lat = location.getLatitude();
        final double lon = location.getLongitude();
        final float accuracy = location.hasAccuracy() ? location.getAccuracy() : -1f;
        String js = String.format(Locale.US,
                "window.onNativeLocation && window.onNativeLocation(%.8f,%.8f,%.1f)",
                lat, lon, accuracy);
        sendJs(js);
    }

    private void sendLocationError(String message) {
        String safe = message.replace("\\", "\\\\").replace("'", "\\'");
        sendJs("window.onNativeLocationError && window.onNativeLocationError('" + safe + "')");
    }

    private void sendJs(String js) {
        if (webView == null) return;
        webView.post(() -> webView.evaluateJavascript(js, null));
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == LOCATION_REQUEST) {
            boolean granted = false;
            for (int result : grantResults) {
                if (result == PackageManager.PERMISSION_GRANTED) {
                    granted = true;
                    break;
                }
            }
            if (granted) obtainLocation();
            else sendLocationError("Nie udzielono dostępu do lokalizacji");
        }
    }

    @Override
    public void onSensorChanged(SensorEvent event) {
        if (!compassRunning || event.sensor.getType() != Sensor.TYPE_ROTATION_VECTOR) return;

        float[] rotationMatrix = new float[9];
        float[] adjusted = new float[9];
        SensorManager.getRotationMatrixFromVector(rotationMatrix, event.values);

        int rotation = getWindowManager().getDefaultDisplay().getRotation();
        switch (rotation) {
            case Surface.ROTATION_90:
                SensorManager.remapCoordinateSystem(rotationMatrix, SensorManager.AXIS_Y, SensorManager.AXIS_MINUS_X, adjusted);
                break;
            case Surface.ROTATION_180:
                SensorManager.remapCoordinateSystem(rotationMatrix, SensorManager.AXIS_MINUS_X, SensorManager.AXIS_MINUS_Y, adjusted);
                break;
            case Surface.ROTATION_270:
                SensorManager.remapCoordinateSystem(rotationMatrix, SensorManager.AXIS_MINUS_Y, SensorManager.AXIS_X, adjusted);
                break;
            default:
                System.arraycopy(rotationMatrix, 0, adjusted, 0, rotationMatrix.length);
        }

        float[] orientation = new float[3];
        SensorManager.getOrientation(adjusted, orientation);
        float heading = (float) Math.toDegrees(orientation[0]);
        heading = (heading + 360f) % 360f;

        String js = String.format(Locale.US,
                "window.onCompassHeading && window.onCompassHeading(%.1f)", heading);
        sendJs(js);
    }

    @Override
    public void onAccuracyChanged(Sensor sensor, int accuracy) {
    }
}
