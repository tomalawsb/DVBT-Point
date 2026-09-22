package pl.dvbt.asystent;

import android.Manifest;
import android.app.Activity;
import android.content.Context;
import android.content.pm.PackageManager;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Bundle;
import android.os.Looper;
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
    private boolean locationRequested = false;
    private LocationListener locationListener;

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
        settings.setAllowFileAccessFromFileURLs(true);
        settings.setAllowUniversalAccessFromFileURLs(true);
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
        if (locationRequested) ensureLocation();
    }

    @Override
    protected void onPause() {
        sensorManager.unregisterListener(this);
        stopLocationUpdates();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        stopLocationUpdates();
        if (webView != null) {
            webView.removeJavascriptInterface("Android");
            webView.destroy();
        }
        super.onDestroy();
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }

    private class NativeBridge {
        @JavascriptInterface
        public void requestLocation() {
            runOnUiThread(() -> {
                locationRequested = true;
                ensureLocation();
            });
        }

        @JavascriptInterface
        public void startCompass() {
            runOnUiThread(() -> {
                compassRunning = true;
                if (rotationSensor == null) {
                    sendJs("window.onCompassUnavailable && window.onCompassUnavailable()");
                } else {
                    registerCompass();
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
    }

    private void registerCompass() {
        if (rotationSensor != null) {
            sensorManager.unregisterListener(this);
            sensorManager.registerListener(this, rotationSensor, SensorManager.SENSOR_DELAY_GAME);
        }
    }

    private void ensureLocation() {
        if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED &&
                checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION}, LOCATION_REQUEST);
            return;
        }
        startLocationUpdates();
    }

    private void startLocationUpdates() {
        if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED &&
                checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) != PackageManager.PERMISSION_GRANTED) return;

        stopLocationUpdates();
        sendBestLastKnownLocation();

        locationListener = new LocationListener() {
            @Override
            public void onLocationChanged(Location location) {
                sendLocation(location);
            }
        };

        boolean anyProvider = false;
        try {
            if (locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
                locationManager.requestLocationUpdates(LocationManager.GPS_PROVIDER, 1000L, 1f, locationListener, Looper.getMainLooper());
                anyProvider = true;
            }
        } catch (Exception ignored) {}

        try {
            if (locationManager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) {
                locationManager.requestLocationUpdates(LocationManager.NETWORK_PROVIDER, 2500L, 3f, locationListener, Looper.getMainLooper());
                anyProvider = true;
            }
        } catch (Exception ignored) {}

        if (!anyProvider) sendLocationError("włącz lokalizację w telefonie");
    }

    private void stopLocationUpdates() {
        if (locationListener != null) {
            try { locationManager.removeUpdates(locationListener); } catch (Exception ignored) {}
            locationListener = null;
        }
    }

    private void sendBestLastKnownLocation() {
        if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED &&
                checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) != PackageManager.PERMISSION_GRANTED) return;
        Location best = null;
        try {
            List<String> providers = locationManager.getProviders(true);
            for (String provider : providers) {
                Location candidate = locationManager.getLastKnownLocation(provider);
                if (candidate == null) continue;
                if (best == null || (candidate.getTime() > best.getTime() && candidate.getAccuracy() <= best.getAccuracy() * 2f) || candidate.getAccuracy() < best.getAccuracy()) best = candidate;
            }
        } catch (Exception ignored) {}
        if (best != null) sendLocation(best);
    }

    private void sendLocation(Location location) {
        if (location == null) return;
        String js = String.format(Locale.US,
                "window.onNativeLocation && window.onNativeLocation(%.8f,%.8f,%.1f)",
                location.getLatitude(), location.getLongitude(), location.hasAccuracy() ? location.getAccuracy() : -1f);
        sendJs(js);
    }

    private void sendLocationError(String message) {
        String safe = message.replace("\\", "\\\\").replace("'", "\\'");
        sendJs("window.onNativeLocationError && window.onNativeLocationError('" + safe + "')");
    }

    private void sendJs(String js) {
        if (webView != null) webView.post(() -> webView.evaluateJavascript(js, null));
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == LOCATION_REQUEST) {
            boolean granted = false;
            for (int result : grantResults) if (result == PackageManager.PERMISSION_GRANTED) { granted = true; break; }
            if (granted) startLocationUpdates();
            else sendLocationError("brak zgody na GPS");
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
                SensorManager.remapCoordinateSystem(rotationMatrix, SensorManager.AXIS_Y, SensorManager.AXIS_MINUS_X, adjusted); break;
            case Surface.ROTATION_180:
                SensorManager.remapCoordinateSystem(rotationMatrix, SensorManager.AXIS_MINUS_X, SensorManager.AXIS_MINUS_Y, adjusted); break;
            case Surface.ROTATION_270:
                SensorManager.remapCoordinateSystem(rotationMatrix, SensorManager.AXIS_MINUS_Y, SensorManager.AXIS_X, adjusted); break;
            default:
                System.arraycopy(rotationMatrix, 0, adjusted, 0, rotationMatrix.length);
        }
        float[] orientation = new float[3];
        SensorManager.getOrientation(adjusted, orientation);
        float heading = ((float) Math.toDegrees(orientation[0]) + 360f) % 360f;
        sendJs(String.format(Locale.US, "window.onCompassHeading && window.onCompassHeading(%.1f)", heading));
    }

    @Override
    public void onAccuracyChanged(Sensor sensor, int accuracy) {}
}
