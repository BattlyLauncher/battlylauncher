package com.battlylauncher.injector.v2;

import java.lang.reflect.Field;
import java.net.URL;
import java.net.URLStreamHandler;
import java.net.URLStreamHandlerFactory;
import java.util.Map;

final class UrlFactoryInstaller implements URLStreamHandlerFactory {
    private final URLStreamHandlerFactory previous;
    private final ProfileInterceptor interceptor;
    private final LegacyTextureInterceptor legacy;
    private final MinecraftSocialEndpoint social;

    private UrlFactoryInstaller(URLStreamHandlerFactory previous, ProfileInterceptor interceptor,
                                LegacyTextureInterceptor legacy, MinecraftSocialEndpoint social) {
        this.previous = previous;
        this.interceptor = interceptor;
        this.legacy = legacy;
        this.social = social;
    }

    @Override
    public URLStreamHandler createURLStreamHandler(String protocol) {
        if ("https".equals(protocol)) {
            return new InterceptingHttpsHandler(interceptor, legacy, social);
        }
        if ("http".equals(protocol)) return new InterceptingHttpHandler(legacy);
        return previous == null ? null : previous.createURLStreamHandler(protocol);
    }

    static void install(ProfileInterceptor interceptor, LegacyTextureInterceptor legacy,
                        MinecraftSocialEndpoint social) {
        if (loaderWillInstallFactory()) {
            Thread thread = new Thread(() -> waitForLoaderAndInstall(interceptor, legacy, social),
                    "battly-v2-url-installer");
            thread.setDaemon(true);
            thread.start();
        } else {
            installNow(interceptor, legacy, social);
        }
    }

    private static boolean loaderWillInstallFactory() {
        try {
            return loaderWillInstallFactory(System.getProperty("java.class.path", "") + " " + System.getProperty("sun.java.command", ""),
                    factoryField().get(null) != null);
        } catch (Throwable ignored) {
            return false;
        }
    }

    static boolean loaderWillInstallFactory(String classPath, boolean factoryInstalled) {
        if (factoryInstalled) return false;
        String normalized = classPath == null ? "" : classPath.toLowerCase();
        return normalized.contains("modlauncher") || normalized.contains("fmlloader")
                || normalized.contains("quilt-loader") || normalized.contains("org/quiltmc");
    }

    private static void waitForLoaderAndInstall(ProfileInterceptor interceptor, LegacyTextureInterceptor legacy,
                                                MinecraftSocialEndpoint social) {
        long deadline = System.currentTimeMillis() + 30_000L;
        try {
            Field field = factoryField();
            while (System.currentTimeMillis() < deadline && field.get(null) == null) {
                Thread.sleep(10L);
            }
            if (field.get(null) == null) {
                Log.warning("Loader URL factory was not installed; HTTPS interception remains disabled");
                return;
            }
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
            return;
        } catch (Throwable error) {
            Log.debug("Could not observe loader URL factory: " + error.getClass().getSimpleName());
        }
        installNow(interceptor, legacy, social);
    }

    @SuppressWarnings("unchecked")
    private static void installNow(ProfileInterceptor interceptor, LegacyTextureInterceptor legacy,
                                   MinecraftSocialEndpoint social) {
        try {
            synchronized (URL.class) {
                Field factory = factoryField();
                Object current = factory.get(null);
                if (current instanceof UrlFactoryInstaller) return;
                factory.set(null, new UrlFactoryInstaller((URLStreamHandlerFactory) current, interceptor,
                        legacy, social));

                Field handlers = URL.class.getDeclaredField("handlers");
                handlers.setAccessible(true);
                Object value = handlers.get(null);
                if (value instanceof Map) ((Map<Object, Object>) value).clear();
            }
            Log.info("HTTPS profile interception enabled");
        } catch (Throwable error) {
            Log.warning("HTTPS interception unavailable; Minecraft will continue without Battly skins ("
                    + error.getClass().getSimpleName() + ")");
        }
    }

    private static Field factoryField() throws Exception {
        Field field = URL.class.getDeclaredField("factory");
        field.setAccessible(true);
        return field;
    }
}
