foreach(required_variable
    CXX_COMPILER
    PIPL_TOOL
    PIPL_SOURCE
    PLUGIN_HOST_INCLUDE
    AE_HEADERS_INCLUDE
    OUTPUT_DIR)
  if(NOT DEFINED ${required_variable} OR "${${required_variable}}" STREQUAL "")
    message(FATAL_ERROR "${required_variable} is required")
  endif()
endforeach()

file(MAKE_DIRECTORY "${OUTPUT_DIR}")

set(preprocessed_resource "${OUTPUT_DIR}/MomentumPiPL.rr")
set(converted_resource "${OUTPUT_DIR}/MomentumPiPL.rrc")
set(windows_resource "${OUTPUT_DIR}/MomentumPiPL.rc")

execute_process(
  COMMAND "${CXX_COMPILER}"
    /nologo
    /EP
    /DWIN32
    /D_WIN64
    /DMSWindows
    "/I${PLUGIN_HOST_INCLUDE}"
    "/I${AE_HEADERS_INCLUDE}"
    "${PIPL_SOURCE}"
  OUTPUT_FILE "${preprocessed_resource}"
  ERROR_VARIABLE preprocess_error
  RESULT_VARIABLE preprocess_result
)
if(NOT preprocess_result EQUAL 0)
  message(FATAL_ERROR "PiPL preprocessing failed:\n${preprocess_error}")
endif()

execute_process(
  COMMAND "${PIPL_TOOL}"
    "${preprocessed_resource}"
    "${converted_resource}"
  ERROR_VARIABLE conversion_error
  RESULT_VARIABLE conversion_result
)
if(NOT conversion_result EQUAL 0)
  message(FATAL_ERROR "PiPL conversion failed:\n${conversion_error}")
endif()

execute_process(
  COMMAND "${CXX_COMPILER}"
    /nologo
    /EP
    /DMSWindows
    "${converted_resource}"
  OUTPUT_FILE "${windows_resource}"
  ERROR_VARIABLE resource_error
  RESULT_VARIABLE resource_result
)
if(NOT resource_result EQUAL 0)
  message(FATAL_ERROR "Windows resource generation failed:\n${resource_error}")
endif()
