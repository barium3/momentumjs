cmake_minimum_required(VERSION 3.21)

project(momentum_ae_plugin LANGUAGES C CXX)

if(APPLE)
  enable_language(OBJCXX)
endif()

set(MOMENTUM_PLUGIN_NAME Momentum)

find_package(PkgConfig REQUIRED)
pkg_check_modules(FREETYPE2 REQUIRED IMPORTED_TARGET freetype2)
pkg_check_modules(HARFBUZZ REQUIRED IMPORTED_TARGET harfbuzz)

if(NOT DEFINED ENV{AE_SDK_ROOT})
  message(FATAL_ERROR "AE_SDK_ROOT must point to the Adobe After Effects SDK root.")
endif()

set(AE_SDK_ROOT "$ENV{AE_SDK_ROOT}")

add_library(${MOMENTUM_PLUGIN_NAME} MODULE
  src/plugin/entry/effect_main.cpp
  src/plugin/gpu/bitmap_gpu_backend.cpp
  src/plugin/gpu/bitmap_gpu_plan.cpp
  src/plugin/render/render_core.cpp
  src/plugin/cache/frame_cache.cpp
  src/plugin/api/api_shared.cpp
  src/plugin/api/api_style.cpp
  src/plugin/api/api_image.cpp
  src/plugin/api/api_graphics.cpp
  src/plugin/api/api_math.cpp
  src/plugin/api/api_data.cpp
  src/plugin/api/api_io.cpp
  src/plugin/api/api_typography.cpp
  src/plugin/api/api_shapes.cpp
  src/plugin/api/api_paths.cpp
  src/plugin/api/api_bootstrap.cpp
  src/plugin/render/render_image.cpp
  src/plugin/render/render_text.cpp
  src/plugin/runtime/runtime_core.cpp
  src/plugin/runtime/runtime_environment.cpp
  src/plugin/runtime/runtime_js.cpp
  src/plugin/runtime/runtime_source.cpp
  src/plugin/MomentumPiPL.r
)

if(APPLE)
  target_sources(${MOMENTUM_PLUGIN_NAME} PRIVATE
    src/plugin/gpu/bitmap_gpu_backend_metal.mm
  )
endif()

target_compile_features(${MOMENTUM_PLUGIN_NAME} PRIVATE cxx_std_17)

target_include_directories(${MOMENTUM_PLUGIN_NAME} PRIVATE
  "${AE_SDK_ROOT}"
  "${AE_SDK_ROOT}/Examples"
  "${AE_SDK_ROOT}/Examples/Headers"
  "${AE_SDK_ROOT}/Examples/Headers/SP"
  "${AE_SDK_ROOT}/Examples/Util"
  "${AE_SDK_ROOT}/Examples/Resources"
  ${FREETYPE2_INCLUDE_DIRS}
  ${HARFBUZZ_INCLUDE_DIRS}
)

target_compile_definitions(${MOMENTUM_PLUGIN_NAME} PRIVATE
  DYNAMIC_LINK=1
)

if(APPLE)
  find_library(JAVASCRIPTCORE_FRAMEWORK JavaScriptCore REQUIRED)
  find_library(COREFOUNDATION_FRAMEWORK CoreFoundation REQUIRED)
  find_library(COREGRAPHICS_FRAMEWORK CoreGraphics REQUIRED)
  find_library(IMAGEIO_FRAMEWORK ImageIO REQUIRED)
  find_library(FOUNDATION_FRAMEWORK Foundation REQUIRED)
  find_library(METAL_FRAMEWORK Metal REQUIRED)
  target_link_libraries(
    ${MOMENTUM_PLUGIN_NAME}
    PRIVATE
      "${JAVASCRIPTCORE_FRAMEWORK}"
      "${COREFOUNDATION_FRAMEWORK}"
      "${COREGRAPHICS_FRAMEWORK}"
      "${IMAGEIO_FRAMEWORK}"
      "${FOUNDATION_FRAMEWORK}"
      "${METAL_FRAMEWORK}"
      PkgConfig::FREETYPE2
      PkgConfig::HARFBUZZ
  )

  set_target_properties(${MOMENTUM_PLUGIN_NAME} PROPERTIES
    BUNDLE TRUE
    BUNDLE_EXTENSION plugin
    OUTPUT_NAME "${MOMENTUM_PLUGIN_NAME}"
    PREFIX ""
    SUFFIX ""
    MACOSX_BUNDLE_INFO_PLIST "${CMAKE_CURRENT_SOURCE_DIR}/src/plugin/Momentum.plugin-Info.plist"
  )

  set_target_properties(${MOMENTUM_PLUGIN_NAME} PROPERTIES
    XCODE_ATTRIBUTE_GENERATE_PKGINFO_FILE "YES"
    XCODE_ATTRIBUTE_WRAPPER_EXTENSION "plugin"
    XCODE_ATTRIBUTE_PRODUCT_BUNDLE_IDENTIFIER "com.barium3.aftereffects.Momentum"
    XCODE_ATTRIBUTE_REZ_SEARCH_PATHS "\"${AE_SDK_ROOT}/Headers\" \"${AE_SDK_ROOT}/Examples/Headers\" \"${AE_SDK_ROOT}/Examples/Util\" \"${AE_SDK_ROOT}/Examples/Resources\""
    XCODE_ATTRIBUTE_REZ_PREPROCESSOR_DEFINITIONS "__MACH__"
  )

  add_custom_command(TARGET ${MOMENTUM_PLUGIN_NAME} POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E make_directory "$<TARGET_BUNDLE_CONTENT_DIR:${MOMENTUM_PLUGIN_NAME}>/Resources"
    COMMAND xcrun Rez -useDF -d __MACH__
      -i "${AE_SDK_ROOT}/Examples/Headers"
      -i "${AE_SDK_ROOT}/Examples/Util"
      -i "${AE_SDK_ROOT}/Examples/Resources"
      -o "$<TARGET_BUNDLE_CONTENT_DIR:${MOMENTUM_PLUGIN_NAME}>/Resources/${MOMENTUM_PLUGIN_NAME}.rsrc"
      "${CMAKE_CURRENT_SOURCE_DIR}/src/plugin/MomentumPiPL.r"
    COMMAND codesign --force --sign - "$<TARGET_BUNDLE_DIR:${MOMENTUM_PLUGIN_NAME}>"
    VERBATIM
  )
endif()
