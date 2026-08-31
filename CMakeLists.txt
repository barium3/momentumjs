cmake_minimum_required(VERSION 3.21)

project(momentum_ae_plugin LANGUAGES C CXX)

if(APPLE)
  enable_language(OBJCXX)
endif()

set(MOMENTUM_PLUGIN_NAME Momentum)

if(WIN32)
  add_compile_definitions(NOMINMAX WIN32_LEAN_AND_MEAN)
  if(MSVC)
    add_compile_options(/utf-8)
  endif()

  find_package(boost_multiprecision CONFIG REQUIRED)
  find_package(Freetype REQUIRED)
  find_package(harfbuzz CONFIG REQUIRED)
  find_package(qjs CONFIG REQUIRED)
  set(MOMENTUM_TEXT_LIBRARIES
    Freetype::Freetype
    harfbuzz::harfbuzz
  )
  set(MOMENTUM_WIDE_INTEGER_LIBRARIES Boost::multiprecision)
  set(MOMENTUM_SCRIPTING_LIBRARIES qjs)
  set(MOMENTUM_PLATFORM_INCLUDE_DIRS
    "${CMAKE_CURRENT_SOURCE_DIR}/src/plugin/platform/windows"
  )
else()
  find_package(PkgConfig REQUIRED)
  pkg_check_modules(FREETYPE2 REQUIRED IMPORTED_TARGET freetype2)
  pkg_check_modules(HARFBUZZ REQUIRED IMPORTED_TARGET harfbuzz)
  set(MOMENTUM_TEXT_LIBRARIES
    PkgConfig::FREETYPE2
    PkgConfig::HARFBUZZ
  )
endif()

if(NOT DEFINED ENV{AE_SDK_ROOT})
  message(FATAL_ERROR "AE_SDK_ROOT must point to the Adobe After Effects SDK root.")
endif()

set(AE_SDK_ROOT "$ENV{AE_SDK_ROOT}")

set(MOMENTUM_HOST_SOURCES
  src/plugin/host/entry.cpp
  src/plugin/host/effect/code_editor.cpp
  src/plugin/host/effect/events.cpp
  src/plugin/host/effect/parameters.cpp
  src/plugin/host/effect/render.cpp
  src/plugin/host/effect/sequence.cpp
  src/plugin/host/sequence_data.cpp
  src/plugin/host/code/snapshot.cpp
  src/plugin/host/code/timeline.cpp
  src/plugin/host/resources/MomentumPiPL.r
)

set(MOMENTUM_CONTROLLER_SOURCES
  src/plugin/controllers/schema.cpp
)

set(MOMENTUM_RENDERING_SOURCES
  src/plugin/rendering/bitmap/planning/planner.cpp
  src/plugin/rendering/bitmap/planning/geometry.cpp
  src/plugin/rendering/bitmap/resources/cache.cpp
  src/plugin/rendering/bitmap/backends/cpu/renderer.cpp
  src/plugin/rendering/bitmap/backends/gpu/renderer.cpp
  src/plugin/rendering/software/rasterizer.cpp
  src/plugin/rendering/software/image.cpp
  src/plugin/rendering/software/text.cpp
)

set(MOMENTUM_SCRIPTING_SOURCES
  src/plugin/scripting/api/shared.cpp
  src/plugin/scripting/api/style.cpp
  src/plugin/scripting/api/image.cpp
  src/plugin/scripting/api/graphics.cpp
  src/plugin/scripting/api/math.cpp
  src/plugin/scripting/api/data.cpp
  src/plugin/scripting/api/io.cpp
  src/plugin/scripting/api/typography.cpp
  src/plugin/scripting/api/shapes.cpp
  src/plugin/scripting/api/paths.cpp
  src/plugin/scripting/api/bootstrap.cpp
  src/plugin/scripting/api/bootstrap_scripts.cpp
  src/plugin/scripting/api/controller.cpp
  src/plugin/scripting/runtime/core.cpp
  src/plugin/scripting/runtime/frame_cache.cpp
  src/plugin/scripting/runtime/environment.cpp
  src/plugin/scripting/runtime/maintenance.cpp
  src/plugin/scripting/runtime/javascript.cpp
  src/plugin/scripting/runtime/source.cpp
)

add_library(${MOMENTUM_PLUGIN_NAME} MODULE
  ${MOMENTUM_HOST_SOURCES}
  ${MOMENTUM_CONTROLLER_SOURCES}
  ${MOMENTUM_RENDERING_SOURCES}
  ${MOMENTUM_SCRIPTING_SOURCES}
)

if(WIN32)
  target_sources(${MOMENTUM_PLUGIN_NAME} PRIVATE
    src/plugin/platform/windows/javascriptcore_compat.cpp
  )

  set(MOMENTUM_WINDOWS_PIPL_DIR
    "${CMAKE_CURRENT_BINARY_DIR}/generated/pipl"
  )
  set(MOMENTUM_WINDOWS_PIPL_RC
    "${MOMENTUM_WINDOWS_PIPL_DIR}/MomentumPiPL.rc"
  )
  add_custom_command(
    OUTPUT "${MOMENTUM_WINDOWS_PIPL_RC}"
    COMMAND "${CMAKE_COMMAND}"
      "-DCXX_COMPILER=${CMAKE_CXX_COMPILER}"
      "-DPIPL_TOOL=${AE_SDK_ROOT}/Examples/Resources/PiPLtool.exe"
      "-DPIPL_SOURCE=${CMAKE_CURRENT_SOURCE_DIR}/src/plugin/host/resources/MomentumPiPL.r"
      "-DPLUGIN_HOST_INCLUDE=${CMAKE_CURRENT_SOURCE_DIR}/src/plugin/host"
      "-DAE_HEADERS_INCLUDE=${AE_SDK_ROOT}/Examples/Headers"
      "-DOUTPUT_DIR=${MOMENTUM_WINDOWS_PIPL_DIR}"
      -P "${CMAKE_CURRENT_SOURCE_DIR}/cmake/BuildWindowsPiPL.cmake"
    DEPENDS
      src/plugin/host/resources/MomentumPiPL.r
      src/plugin/host/effect_contract.h
      src/plugin/host/version.h
      "${CMAKE_CURRENT_SOURCE_DIR}/cmake/BuildWindowsPiPL.cmake"
    COMMENT "Compiling the Windows PiPL resource"
    VERBATIM
  )
  target_sources(${MOMENTUM_PLUGIN_NAME} PRIVATE
    "${MOMENTUM_WINDOWS_PIPL_RC}"
  )
  set_target_properties(${MOMENTUM_PLUGIN_NAME} PROPERTIES
    OUTPUT_NAME "${MOMENTUM_PLUGIN_NAME}"
    PREFIX ""
    SUFFIX ".aex"
  )
endif()

if(APPLE)
  target_sources(${MOMENTUM_PLUGIN_NAME} PRIVATE
    src/plugin/rendering/bitmap/backends/metal/shaders.cpp
    src/plugin/rendering/bitmap/backends/metal/renderer.mm
  )
endif()

target_compile_features(${MOMENTUM_PLUGIN_NAME} PRIVATE cxx_std_17)

target_include_directories(${MOMENTUM_PLUGIN_NAME} PRIVATE
  "${CMAKE_CURRENT_SOURCE_DIR}/src/plugin"
  "${AE_SDK_ROOT}"
  "${AE_SDK_ROOT}/Examples"
  "${AE_SDK_ROOT}/Examples/Headers"
  "${AE_SDK_ROOT}/Examples/Headers/SP"
  "${AE_SDK_ROOT}/Examples/Util"
  "${AE_SDK_ROOT}/Examples/Resources"
  ${MOMENTUM_PLATFORM_INCLUDE_DIRS}
)

target_compile_definitions(${MOMENTUM_PLUGIN_NAME} PRIVATE
  DYNAMIC_LINK=1
)

target_link_libraries(${MOMENTUM_PLUGIN_NAME} PRIVATE
  ${MOMENTUM_TEXT_LIBRARIES}
  ${MOMENTUM_WIDE_INTEGER_LIBRARIES}
  ${MOMENTUM_SCRIPTING_LIBRARIES}
)

if(WIN32)
  target_link_libraries(${MOMENTUM_PLUGIN_NAME} PRIVATE
    windowscodecs
    ole32
  )
endif()

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
  )

  set_target_properties(${MOMENTUM_PLUGIN_NAME} PROPERTIES
    BUNDLE TRUE
    BUNDLE_EXTENSION plugin
    OUTPUT_NAME "${MOMENTUM_PLUGIN_NAME}"
    PREFIX ""
    SUFFIX ""
    MACOSX_BUNDLE_INFO_PLIST "${CMAKE_CURRENT_SOURCE_DIR}/src/plugin/host/resources/Momentum.plugin-Info.plist"
  )

  set_target_properties(${MOMENTUM_PLUGIN_NAME} PROPERTIES
    XCODE_ATTRIBUTE_GENERATE_PKGINFO_FILE "YES"
    XCODE_ATTRIBUTE_WRAPPER_EXTENSION "plugin"
    XCODE_ATTRIBUTE_PRODUCT_BUNDLE_IDENTIFIER "com.barium3.aftereffects.Momentum"
    XCODE_ATTRIBUTE_REZ_SEARCH_PATHS "\"${CMAKE_CURRENT_SOURCE_DIR}/src/plugin/host\" \"${AE_SDK_ROOT}/Headers\" \"${AE_SDK_ROOT}/Examples/Headers\" \"${AE_SDK_ROOT}/Examples/Util\" \"${AE_SDK_ROOT}/Examples/Resources\""
    XCODE_ATTRIBUTE_REZ_PREPROCESSOR_DEFINITIONS "__MACH__"
  )

  add_custom_command(TARGET ${MOMENTUM_PLUGIN_NAME} POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E make_directory "$<TARGET_BUNDLE_CONTENT_DIR:${MOMENTUM_PLUGIN_NAME}>/Resources"
    COMMAND xcrun Rez -useDF -d __MACH__
      -i "${CMAKE_CURRENT_SOURCE_DIR}/src/plugin/host"
      -i "${AE_SDK_ROOT}/Examples/Headers"
      -i "${AE_SDK_ROOT}/Examples/Util"
      -i "${AE_SDK_ROOT}/Examples/Resources"
      -o "$<TARGET_BUNDLE_CONTENT_DIR:${MOMENTUM_PLUGIN_NAME}>/Resources/${MOMENTUM_PLUGIN_NAME}.rsrc"
      "${CMAKE_CURRENT_SOURCE_DIR}/src/plugin/host/resources/MomentumPiPL.r"
    COMMAND codesign --force --sign - "$<TARGET_BUNDLE_DIR:${MOMENTUM_PLUGIN_NAME}>"
    VERBATIM
  )
endif()

include(CTest)
if(BUILD_TESTING)
  add_executable(momentum_canvas_surface_contract_test
    tests/canvas_surface_contract_test.cpp
    src/plugin/rendering/bitmap/planning/planner.cpp
    src/plugin/rendering/bitmap/planning/geometry.cpp
    src/plugin/rendering/bitmap/resources/cache.cpp
    src/plugin/rendering/bitmap/backends/cpu/renderer.cpp
    src/plugin/rendering/software/rasterizer.cpp
    src/plugin/rendering/software/image.cpp
    src/plugin/rendering/software/text.cpp
  )
  target_compile_features(momentum_canvas_surface_contract_test PRIVATE cxx_std_17)
  target_include_directories(momentum_canvas_surface_contract_test PRIVATE
    "${CMAKE_CURRENT_SOURCE_DIR}/src/plugin"
    "${AE_SDK_ROOT}"
    "${AE_SDK_ROOT}/Examples"
    "${AE_SDK_ROOT}/Examples/Headers"
    "${AE_SDK_ROOT}/Examples/Headers/SP"
    "${AE_SDK_ROOT}/Examples/Util"
    "${AE_SDK_ROOT}/Examples/Resources"
  )
  target_compile_definitions(momentum_canvas_surface_contract_test PRIVATE
    DYNAMIC_LINK=1
  )
  target_link_libraries(momentum_canvas_surface_contract_test PRIVATE
    ${MOMENTUM_TEXT_LIBRARIES}
  )
  if(APPLE)
    target_link_libraries(momentum_canvas_surface_contract_test PRIVATE
      "${COREFOUNDATION_FRAMEWORK}"
      "${COREGRAPHICS_FRAMEWORK}"
      "${IMAGEIO_FRAMEWORK}"
    )
  elseif(WIN32)
    target_link_libraries(momentum_canvas_surface_contract_test PRIVATE
      windowscodecs
      ole32
    )
  endif()
  add_test(
    NAME momentum_canvas_surface_contract
    COMMAND momentum_canvas_surface_contract_test
  )

  add_executable(momentum_runtime_maintenance_test
    tests/runtime_maintenance_test.cpp
    src/plugin/scripting/runtime/maintenance.cpp
  )
  target_compile_features(momentum_runtime_maintenance_test PRIVATE cxx_std_17)
  target_include_directories(momentum_runtime_maintenance_test PRIVATE
    "${CMAKE_CURRENT_SOURCE_DIR}/src/plugin"
  )
  add_test(
    NAME momentum_runtime_maintenance
    COMMAND momentum_runtime_maintenance_test
  )

  add_executable(momentum_code_timeline_time_test
    tests/code_timeline_time_test.cpp
    src/plugin/host/code/timeline.cpp
  )
  target_compile_features(momentum_code_timeline_time_test PRIVATE cxx_std_17)
  target_include_directories(momentum_code_timeline_time_test PRIVATE
    "${CMAKE_CURRENT_SOURCE_DIR}/src/plugin"
    "${AE_SDK_ROOT}"
    "${AE_SDK_ROOT}/Examples"
    "${AE_SDK_ROOT}/Examples/Headers"
    "${AE_SDK_ROOT}/Examples/Headers/SP"
    "${AE_SDK_ROOT}/Examples/Util"
    "${AE_SDK_ROOT}/Examples/Resources"
  )
  target_compile_definitions(momentum_code_timeline_time_test PRIVATE
    DYNAMIC_LINK=1
  )
  target_link_libraries(momentum_code_timeline_time_test PRIVATE
    ${MOMENTUM_WIDE_INTEGER_LIBRARIES}
  )
  add_test(
    NAME momentum_code_timeline_time
    COMMAND momentum_code_timeline_time_test
  )

  add_executable(momentum_image_pixel_cow_test
    tests/image_pixel_cow_test.cpp
  )
  target_compile_features(momentum_image_pixel_cow_test PRIVATE cxx_std_17)
  target_include_directories(momentum_image_pixel_cow_test PRIVATE
    "${CMAKE_CURRENT_SOURCE_DIR}/src/plugin"
    "${AE_SDK_ROOT}"
    "${AE_SDK_ROOT}/Examples"
    "${AE_SDK_ROOT}/Examples/Headers"
    "${AE_SDK_ROOT}/Examples/Headers/SP"
    "${AE_SDK_ROOT}/Examples/Util"
    "${AE_SDK_ROOT}/Examples/Resources"
  )
  target_compile_definitions(momentum_image_pixel_cow_test PRIVATE
    DYNAMIC_LINK=1
  )
  add_test(
    NAME momentum_image_pixel_cow
    COMMAND momentum_image_pixel_cow_test
  )

  if(WIN32)
    add_executable(momentum_windows_image_decode_test
      tests/windows_image_decode_test.cpp
      src/plugin/rendering/software/image.cpp
    )
    target_compile_features(momentum_windows_image_decode_test PRIVATE
      cxx_std_17
    )
    target_include_directories(momentum_windows_image_decode_test PRIVATE
      "${CMAKE_CURRENT_SOURCE_DIR}/src/plugin"
      "${AE_SDK_ROOT}"
      "${AE_SDK_ROOT}/Examples"
      "${AE_SDK_ROOT}/Examples/Headers"
      "${AE_SDK_ROOT}/Examples/Headers/SP"
      "${AE_SDK_ROOT}/Examples/Util"
      "${AE_SDK_ROOT}/Examples/Resources"
    )
    target_compile_definitions(momentum_windows_image_decode_test PRIVATE
      DYNAMIC_LINK=1
    )
    target_link_libraries(momentum_windows_image_decode_test PRIVATE
      windowscodecs
      ole32
    )
    add_test(
      NAME momentum_windows_image_decode
      COMMAND momentum_windows_image_decode_test
        "${CMAKE_CURRENT_SOURCE_DIR}/footage/showcase.png"
    )
  endif()

  add_executable(momentum_angle_math_test
    tests/angle_math_test.cpp
  )
  target_compile_features(momentum_angle_math_test PRIVATE cxx_std_17)
  target_include_directories(momentum_angle_math_test PRIVATE
    "${CMAKE_CURRENT_SOURCE_DIR}/src/plugin"
    "${AE_SDK_ROOT}"
    "${AE_SDK_ROOT}/Examples"
    "${AE_SDK_ROOT}/Examples/Headers"
    "${AE_SDK_ROOT}/Examples/Headers/SP"
    "${AE_SDK_ROOT}/Examples/Util"
    "${AE_SDK_ROOT}/Examples/Resources"
  )
  target_compile_definitions(momentum_angle_math_test PRIVATE
    DYNAMIC_LINK=1
  )
  add_test(
    NAME momentum_angle_math
    COMMAND momentum_angle_math_test
  )

  add_executable(momentum_code_editor_state_test
    tests/code_editor_state_test.cpp
    src/plugin/host/effect/code_editor.cpp
  )
  target_compile_features(momentum_code_editor_state_test PRIVATE cxx_std_17)
  target_include_directories(momentum_code_editor_state_test PRIVATE
    "${CMAKE_CURRENT_SOURCE_DIR}/src/plugin"
    "${AE_SDK_ROOT}"
    "${AE_SDK_ROOT}/Examples"
    "${AE_SDK_ROOT}/Examples/Headers"
    "${AE_SDK_ROOT}/Examples/Headers/SP"
    "${AE_SDK_ROOT}/Examples/Util"
    "${AE_SDK_ROOT}/Examples/Resources"
    ${MOMENTUM_PLATFORM_INCLUDE_DIRS}
  )
  target_compile_definitions(momentum_code_editor_state_test PRIVATE
    DYNAMIC_LINK=1
    MOMENTUM_CODE_EDITOR_STATE_ONLY=1
    MOMENTUM_CODE_EDITOR_INTERNALS=1
  )
  add_test(
    NAME momentum_code_editor_state
    COMMAND momentum_code_editor_state_test
  )

  if(WIN32)
    add_executable(momentum_javascript_compat_test
      tests/javascript_compat_test.cpp
      src/plugin/platform/windows/javascriptcore_compat.cpp
    )
    target_compile_features(momentum_javascript_compat_test PRIVATE cxx_std_17)
    target_include_directories(momentum_javascript_compat_test PRIVATE
      "${CMAKE_CURRENT_SOURCE_DIR}/src/plugin/platform/windows"
    )
    target_link_libraries(momentum_javascript_compat_test PRIVATE qjs)
    add_test(
      NAME momentum_javascript_compat
      COMMAND momentum_javascript_compat_test
    )
  endif()
endif()
