# UC3 Ingestion Wheel

## Private Package Notice

The UC3 ingestion component (`terra-wp2-uc3-ingestion`) is developed and maintained by an external project team in a **private GitHub repository**.

The package's source code and compiled wheel are not publicly available and are not included in this repository. Access to the package must be obtained directly from the UC3 development team or through an authorised distribution channel.

This project integrates the UC3 package as an external dependency but **does not claim ownership or responsibility for its development, maintenance, or distribution**.

## Installation

Before installing the application or building its Docker image, the following wheel must be supplied in this directory:

```text
vendor/
└── terra_wp2_uc3_ingestion-0.5.0-py3-none-any.whl
```

The wheel is intentionally excluded from version control through `.gitignore`.

The package must be built from an authorised copy of the UC3 source repository or provided directly by its maintainers.

## Documentation

For package installation, Docker integration, configuration, validation, and upgrade instructions, refer to:

[UC3 Integration Documentation](../docs/docs/uc3-integration.md)

**Note:** The integration documented in this repository does not grant permission to redistribute the UC3 package or its source code. Any redistribution must comply with the licensing terms and permissions established by its maintainers.