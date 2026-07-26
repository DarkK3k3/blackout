// Plugin de config Expo : active le "core library desugaring" sur
// android/app — exige par org.signal:libsignal-android (qui utilise
// des APIs java.time/java.util recentes sur des minSdk anciens).
// https://developer.android.com/studio/write/java8-support

const { withAppBuildGradle } = require('expo/config-plugins');

const DESUGAR_LIB = "coreLibraryDesugaring 'com.android.tools:desugar_jdk_libs:2.1.5'";

module.exports = function withDesugaring(config) {
  return withAppBuildGradle(config, (config) => {
    let gradle = config.modResults.contents;

    if (!gradle.includes('coreLibraryDesugaringEnabled')) {
      // RN 0.86 n'a plus de bloc compileOptions dans app/build.gradle :
      // on injecte le bloc complet en tete du bloc android {}.
      const patched = gradle.replace(
        /^android\s*\{/m,
        'android {\n    compileOptions {\n        coreLibraryDesugaringEnabled true\n    }\n',
      );
      if (patched === gradle) throw new Error('withDesugaring : bloc android introuvable');
      gradle = patched;
    }

    if (!gradle.includes('coreLibraryDesugaring ')) {
      const patched = gradle.replace(/\ndependencies\s*\{/, `\ndependencies {\n    ${DESUGAR_LIB}`);
      if (patched === gradle) throw new Error('withDesugaring : bloc dependencies introuvable');
      gradle = patched;
    }

    config.modResults.contents = gradle;
    return config;
  });
};
