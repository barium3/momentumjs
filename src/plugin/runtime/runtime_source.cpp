#include "runtime_internal.h"

#include <cctype>
#include <sstream>
#include <unordered_set>

namespace momentum::runtime_internal {

namespace {

bool IsIdentifierStart(char ch) {
  return std::isalpha(static_cast<unsigned char>(ch)) || ch == '_' || ch == '$';
}

bool IsIdentifierPart(char ch) {
  return std::isalnum(static_cast<unsigned char>(ch)) || ch == '_' || ch == '$';
}

bool IsLineBreak(char ch) {
  return ch == '\n' || ch == '\r';
}

void SkipQuotedString(const std::string& source, std::size_t* index, char quote) {
  if (!index || *index >= source.size()) {
    return;
  }

  *index += 1;
  while (*index < source.size()) {
    const char current = source[*index];
    if (current == '\\') {
      *index += std::min<std::size_t>(2, source.size() - *index);
      continue;
    }
    *index += 1;
    if (current == quote) {
      break;
    }
  }
}

void SkipTemplateLiteral(const std::string& source, std::size_t* index) {
  if (!index || *index >= source.size() || source[*index] != '`') {
    return;
  }

  *index += 1;
  while (*index < source.size()) {
    const char current = source[*index];
    if (current == '\\') {
      *index += std::min<std::size_t>(2, source.size() - *index);
      continue;
    }
    if (current == '`') {
      *index += 1;
      return;
    }
    if (
      current == '$' &&
      (*index + 1) < source.size() &&
      source[*index + 1] == '{'
    ) {
      *index += 2;
      int braceDepth = 1;
      while (*index < source.size() && braceDepth > 0) {
        const char exprCurrent = source[*index];
        if (exprCurrent == '\'' || exprCurrent == '"') {
          SkipQuotedString(source, index, exprCurrent);
          continue;
        }
        if (exprCurrent == '`') {
          SkipTemplateLiteral(source, index);
          continue;
        }
        if (
          exprCurrent == '/' &&
          (*index + 1) < source.size() &&
          source[*index + 1] == '/'
        ) {
          *index += 2;
          while (*index < source.size() && !IsLineBreak(source[*index])) {
            *index += 1;
          }
          continue;
        }
        if (
          exprCurrent == '/' &&
          (*index + 1) < source.size() &&
          source[*index + 1] == '*'
        ) {
          *index += 2;
          while (
            (*index + 1) < source.size() &&
            !(source[*index] == '*' && source[*index + 1] == '/')
          ) {
            *index += 1;
          }
          if ((*index + 1) < source.size()) {
            *index += 2;
          }
          continue;
        }
        if (exprCurrent == '{') {
          braceDepth += 1;
        } else if (exprCurrent == '}') {
          braceDepth -= 1;
        }
        *index += 1;
      }
      continue;
    }
    *index += 1;
  }
}

void SkipWhitespaceAndComments(
  const std::string& source,
  std::size_t* index,
  bool* sawNewline = NULL
) {
  if (!index) {
    return;
  }

  while (*index < source.size()) {
    const char current = source[*index];
    if (std::isspace(static_cast<unsigned char>(current))) {
      if (sawNewline && IsLineBreak(current)) {
        *sawNewline = true;
      }
      *index += 1;
      continue;
    }

    if (
      current == '/' &&
      (*index + 1) < source.size() &&
      source[*index + 1] == '/'
    ) {
      *index += 2;
      while (*index < source.size() && !IsLineBreak(source[*index])) {
        *index += 1;
      }
      continue;
    }

    if (
      current == '/' &&
      (*index + 1) < source.size() &&
      source[*index + 1] == '*'
    ) {
      *index += 2;
      while (
        (*index + 1) < source.size() &&
        !(source[*index] == '*' && source[*index + 1] == '/')
      ) {
        if (sawNewline && IsLineBreak(source[*index])) {
          *sawNewline = true;
        }
        *index += 1;
      }
      if ((*index + 1) < source.size()) {
        *index += 2;
      }
      continue;
    }

    break;
  }
}

std::string ReadIdentifier(const std::string& source, std::size_t* index) {
  if (!index || *index >= source.size() || !IsIdentifierStart(source[*index])) {
    return std::string();
  }

  const std::size_t start = *index;
  *index += 1;
  while (*index < source.size() && IsIdentifierPart(source[*index])) {
    *index += 1;
  }
  return source.substr(start, *index - start);
}

void SkipDestructuringPattern(const std::string& source, std::size_t* index) {
  if (!index || *index >= source.size()) {
    return;
  }

  const char opener = source[*index];
  const char closer = opener == '{' ? '}' : ']';
  if (opener != '{' && opener != '[') {
    return;
  }

  int depth = 0;
  while (*index < source.size()) {
    const char current = source[*index];
    if (current == '\'' || current == '"') {
      SkipQuotedString(source, index, current);
      continue;
    }
    if (current == '`') {
      SkipTemplateLiteral(source, index);
      continue;
    }
    if (
      current == '/' &&
      (*index + 1) < source.size() &&
      source[*index + 1] == '/'
    ) {
      SkipWhitespaceAndComments(source, index);
      continue;
    }
    if (
      current == '/' &&
      (*index + 1) < source.size() &&
      source[*index + 1] == '*'
    ) {
      SkipWhitespaceAndComments(source, index);
      continue;
    }
    if (current == opener) {
      depth += 1;
    } else if (current == closer) {
      depth -= 1;
      *index += 1;
      if (depth == 0) {
        break;
      }
      continue;
    }
    *index += 1;
  }
}

void SkipInitializerExpression(const std::string& source, std::size_t* index) {
  if (!index) {
    return;
  }

  int parenDepth = 0;
  int braceDepth = 0;
  int bracketDepth = 0;

  while (*index < source.size()) {
    const char current = source[*index];
    if (current == '\'' || current == '"') {
      SkipQuotedString(source, index, current);
      continue;
    }
    if (current == '`') {
      SkipTemplateLiteral(source, index);
      continue;
    }
    if (
      current == '/' &&
      (*index + 1) < source.size() &&
      (source[*index + 1] == '/' || source[*index + 1] == '*')
    ) {
      SkipWhitespaceAndComments(source, index);
      continue;
    }
    if (current == '(') {
      parenDepth += 1;
      *index += 1;
      continue;
    }
    if (current == ')') {
      parenDepth = std::max(0, parenDepth - 1);
      *index += 1;
      continue;
    }
    if (current == '{') {
      braceDepth += 1;
      *index += 1;
      continue;
    }
    if (current == '}') {
      if (braceDepth == 0 && parenDepth == 0 && bracketDepth == 0) {
        return;
      }
      braceDepth = std::max(0, braceDepth - 1);
      *index += 1;
      continue;
    }
    if (current == '[') {
      bracketDepth += 1;
      *index += 1;
      continue;
    }
    if (current == ']') {
      bracketDepth = std::max(0, bracketDepth - 1);
      *index += 1;
      continue;
    }
    if (
      parenDepth == 0 &&
      braceDepth == 0 &&
      bracketDepth == 0 &&
      (current == ',' || current == ';' || IsLineBreak(current))
    ) {
      return;
    }
    *index += 1;
  }
}

BindingKind BindingKindFromKeyword(const std::string& keyword) {
  if (keyword == "let") {
    return BindingKind::kLet;
  }
  if (keyword == "const") {
    return BindingKind::kConst;
  }
  return BindingKind::kVar;
}

void ParseVariableDeclaration(
  const std::string& source,
  std::size_t* index,
  const std::string& keyword,
  std::vector<CapturedBinding>* bindings
) {
  if (!index || !bindings) {
    return;
  }

  const BindingKind kind = BindingKindFromKeyword(keyword);

  while (*index < source.size()) {
    bool sawNewline = false;
    SkipWhitespaceAndComments(source, index, &sawNewline);
    if (*index >= source.size()) {
      return;
    }
    if (sawNewline && source[*index] != ',') {
      return;
    }

    if (source[*index] == '{' || source[*index] == '[') {
      SkipDestructuringPattern(source, index);
    } else {
      const std::string name = ReadIdentifier(source, index);
      if (!name.empty()) {
        bindings->push_back({name, kind});
      } else {
        return;
      }
    }

    bool postNameNewline = false;
    SkipWhitespaceAndComments(source, index, &postNameNewline);
    if (*index >= source.size()) {
      return;
    }

    if (*index < source.size() && source[*index] == '=') {
      *index += 1;
      SkipInitializerExpression(source, index);
      bool postInitNewline = false;
      SkipWhitespaceAndComments(source, index, &postInitNewline);
      if (*index >= source.size()) {
        return;
      }
    } else if (postNameNewline && source[*index] != ',') {
      return;
    }

    if (*index < source.size() && source[*index] == ',') {
      *index += 1;
      continue;
    }
    if (*index < source.size() && source[*index] == ';') {
      *index += 1;
    }
    return;
  }
}

std::string QuoteJsString(const std::string& value) {
  std::string quoted;
  quoted.reserve(value.size() + 2);
  quoted.push_back('"');
  for (std::size_t index = 0; index < value.size(); index += 1) {
    const char current = value[index];
    if (current == '\\' || current == '"') {
      quoted.push_back('\\');
      quoted.push_back(current);
      continue;
    }
    if (current == '\n') {
      quoted.append("\\n");
      continue;
    }
    if (current == '\r') {
      quoted.append("\\r");
      continue;
    }
    if (current == '\t') {
      quoted.append("\\t");
      continue;
    }
    quoted.push_back(current);
  }
  quoted.push_back('"');
  return quoted;
}

}  // namespace

std::vector<CapturedBinding> ExtractTopLevelBindings(const std::string& source) {
  std::vector<CapturedBinding> bindings;

  int braceDepth = 0;
  int parenDepth = 0;
  int bracketDepth = 0;

  for (std::size_t index = 0; index < source.size();) {
    const char current = source[index];
    if (current == '\'' || current == '"') {
      SkipQuotedString(source, &index, current);
      continue;
    }
    if (current == '`') {
      SkipTemplateLiteral(source, &index);
      continue;
    }
    if (
      current == '/' &&
      (index + 1) < source.size() &&
      (source[index + 1] == '/' || source[index + 1] == '*')
    ) {
      SkipWhitespaceAndComments(source, &index);
      continue;
    }

    if (current == '{') {
      braceDepth += 1;
      index += 1;
      continue;
    }
    if (current == '}') {
      braceDepth = std::max(0, braceDepth - 1);
      index += 1;
      continue;
    }
    if (current == '(') {
      parenDepth += 1;
      index += 1;
      continue;
    }
    if (current == ')') {
      parenDepth = std::max(0, parenDepth - 1);
      index += 1;
      continue;
    }
    if (current == '[') {
      bracketDepth += 1;
      index += 1;
      continue;
    }
    if (current == ']') {
      bracketDepth = std::max(0, bracketDepth - 1);
      index += 1;
      continue;
    }

    if (
      braceDepth == 0 &&
      parenDepth == 0 &&
      bracketDepth == 0 &&
      IsIdentifierStart(current)
    ) {
      const std::size_t tokenStart = index;
      const std::string token = ReadIdentifier(source, &index);
      if (token == "let" || token == "const" || token == "var") {
        const bool leftBoundary =
          tokenStart == 0 || !IsIdentifierPart(source[tokenStart - 1]);
        const bool rightBoundary =
          index >= source.size() || !IsIdentifierPart(source[index]);
        if (leftBoundary && rightBoundary) {
          ParseVariableDeclaration(source, &index, token, &bindings);
          continue;
        }
      }
      continue;
    }

    index += 1;
  }

  return bindings;
}

std::string BuildBindingRegistrationScript(const std::vector<CapturedBinding>& bindings) {
  std::unordered_set<std::string> seen;
  std::ostringstream script;

  for (std::size_t index = 0; index < bindings.size(); index += 1) {
    const CapturedBinding& binding = bindings[index];
    if (binding.name.empty() || !seen.insert(binding.name).second) {
      continue;
    }

    script
      << "__momentumRegisterBinding("
      << QuoteJsString(binding.name)
      << ", function(){ return "
      << binding.name
      << "; }, function(value){ ";

    if (binding.kind == BindingKind::kConst) {
      script
        << "if ("
        << binding.name
        << " && typeof "
        << binding.name
        << " === 'object' && value && typeof value === 'object') { "
        << "__momentumDeepAssign("
        << binding.name
        << ", value); }";
    } else {
      script
        << binding.name
        << " = __momentumDeepAssign("
        << binding.name
        << ", value);";
    }

    script << " });\n";
  }

  return script.str();
}

}  // namespace momentum::runtime_internal
