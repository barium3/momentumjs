if(NOT DEFINED INPUTS OR NOT DEFINED OUTPUT OR NOT DEFINED HEADER OR
   NOT DEFINED NAMESPACE_NAME OR NOT DEFINED FUNCTION_NAME)
  message(FATAL_ERROR "EmbedKernelText.cmake is missing a required argument")
endif()

string(REPLACE "|" ";" INPUT_LIST "${INPUTS}")
set(CONTENT "")
foreach(INPUT_FILE IN LISTS INPUT_LIST)
  file(READ "${INPUT_FILE}" INPUT_CONTENT)
  string(APPEND CONTENT "${INPUT_CONTENT}\n")
endforeach()

string(REPLACE "\\" "\\\\" CONTENT "${CONTENT}")
string(REPLACE "\"" "\\\"" CONTENT "${CONTENT}")
string(REPLACE "\r" "" CONTENT "${CONTENT}")
string(REPLACE "\n" "\\n\"\n  \"" CONTENT "${CONTENT}")

get_filename_component(OUTPUT_DIRECTORY "${OUTPUT}" DIRECTORY)
file(MAKE_DIRECTORY "${OUTPUT_DIRECTORY}")
file(WRITE "${OUTPUT}"
  "#include \"${HEADER}\"\n\n"
  "namespace momentum {\nnamespace bitmap {\nnamespace ${NAMESPACE_NAME} {\n\n"
  "const char* ${FUNCTION_NAME}() {\n"
  "  static const char source[] =\n  \"${CONTENT}\";\n"
  "  return source;\n}\n\n"
  "}  // namespace ${NAMESPACE_NAME}\n}  // namespace bitmap\n}  // namespace momentum\n"
)
