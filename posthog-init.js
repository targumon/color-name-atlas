(() => {
  const config = window.__POSTHOG_CONFIG__;
  if (!config?.key || !config?.host) {
    if (config?.isDevelopment !== false) {
      const missing = config?.key ? "POSTHOG_HOST" : "POSTHOG_KEY";
      throw new Error(`${missing} variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once ${missing} is configured`);
    }
    return;
  }

  const script = document.createElement("script");
  script.src = new URL("/static/array.js", config.host).toString();
  script.onload = () => {
    window.posthog.init(config.key, {
      api_host: config.host,
      capture_exceptions: {
        capture_unhandled_errors: true,
        capture_unhandled_rejections: true,
        capture_console_errors: false,
      },
      logs: {
        serviceName: "color-name-atlas-web",
        environment: config.environment,
      },
    });
    window.posthog.logger?.info("atlas client initialized", { event: "atlas_client_initialized" });
  };
  document.head.append(script);
})();
