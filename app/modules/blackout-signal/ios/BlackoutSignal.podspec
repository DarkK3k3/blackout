Pod::Spec.new do |s|
  s.name           = 'BlackoutSignal'
  s.version        = '1.0.0'
  s.summary        = 'A sample project summary'
  s.description    = 'A sample project description'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = {
    :ios => '16.4',
    :tvos => '16.4'
  }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  # Lib officielle Signal. Le pod n'est pas sur le CDN CocoaPods : il est
  # injecte dans le Podfile via plugins/withLibsignalPod.js (source git,
  # tag v0.99.1 — MEME version que libsignal-android et que les bindings
  # Node des tests). Binaires precompiles telecharges par le podspec de
  # Signal (env LIBSIGNAL_FFI_PREBUILD_CHECKSUM requise, voir eas.json).
  s.dependency 'LibSignalClient'

  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  # Le podspec officiel LibSignalClient ne lie libsignal_ffi.a (coeur Rust,
  # telecharge precompile) que sur SON target — suffisant en frameworks
  # dynamiques (config Signal-iOS), pas en pods statiques (config RN/Expo)
  # ou c'est le binaire de l'APP qui doit le lier. user_target_xcconfig
  # propage au target de l'app le chemin du .a extrait par le script phase
  # du pod ($(OBJROOT)/Pods.build = PROJECT_TEMP_DIR du projet Pods) et les
  # conditions d'arch du podspec officiel. x86_64 simulateur exclu (workers
  # EAS arm64 ; evite aussi un bug de link SwiftUICore x86_64 sous Xcode recents).
  s.user_target_xcconfig = {
    'CARGO_BUILD_TARGET[sdk=iphonesimulator*][arch=arm64]' => 'aarch64-apple-ios-sim',
    'CARGO_BUILD_TARGET[sdk=iphonesimulator*][arch=*]' => 'x86_64-apple-ios',
    'CARGO_BUILD_TARGET[sdk=iphoneos*]' => 'aarch64-apple-ios',
    'EXCLUDED_ARCHS[sdk=iphonesimulator*]' => 'x86_64',
    'OTHER_LDFLAGS' => '$(inherited) $(OBJROOT)/Pods.build/libsignal_ffi/target/$(CARGO_BUILD_TARGET)/release/libsignal_ffi.a',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
