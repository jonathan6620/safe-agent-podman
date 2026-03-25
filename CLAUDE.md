# Use Test-Driven Development (TDD)

1. **Never write implementation code without a failing test**
   - If asked to "create a feature," respond: "Let me write a test first"
   - Read test output to confirm the test fails
   - Only then write minimal code to pass
2. **Minimal code always**
   - Write the simplest code that passes the current test
   - Do not anticipate future requirements
   - Refactor only after tests pass
3. **Silent execution by default**
   - Run tests with --silent or -q flags
   - Only request verbose output for debugging
   - Context window conservation is mandatory
4. **Test isolation is sacred**
   - Each test is independent
   - No shared state between tests
   - No reading production code while writing tests

# General
- Prioritize the simplest-to-implement tasks. 
- Summarize results and findings in a progress.md file. 
- Keep track of any failed analyses/software installations in an advisory.md file. 
- Use this file to document any recommendations you have for overcoming these failures (e.g. running code on an instance with CUDA).

# Python
- Write all data analyses in Python. 
- Install uv and prefer using this tool to manage python dependencies, and record these dependencies in a pyproject.toml file.
- If uv is not suitable for managing dependencies use mamba/conda. 
- Use static typing with mypy.
- Lint code with ruff regularly. Correct any issues that are identified with ruff. 
- Record results in Jupyter notebooks that provide an explanation of the steps used to generate the results. 
- Execute any notebooks to html in both with-code and no-code formats. 

# Front-end
- Where possible use static web-pages, using Astro, with interactive elements using React.
- Use tailwind.css for graphic elements. 
- Use typescript and jslint to ensure javascript code quality.

# Back-end
- Prefer using postgres for storing data. 
- Supabase can be used for Auth and/or data where appropriate.
- Prefer FastAPI for end-points. 
- Use Rust for any performance-critical steps. 

