import subprocess
import sys


def run_command(command):
    """Utility to run shell commands and stream output."""
    try:
        subprocess.run(command, shell=True, check=True)
    except subprocess.CalledProcessError as e:
        print(f"Error executing: {command}\nException: {e}")
        sys.exit(1)


def main():
    # 1. Create the environment
    print("--- Creating Conda Environment ---")
    run_command("conda create -n forecaster-parity python=3.11 -y")

    # 2. Install packages inside the specific environment without needing 'activate'
    print("\n--- Installing Packages ---")
    packages = "requests numpy pandas pillow rasterio shapely pyproj geopandas sentinelhub"

    # Using 'conda run' executes the command explicitly inside that environment
    run_command(f"conda run -n forecaster-parity pip install {packages}")

    print("\n--- Setup Complete! ---")
    print("To start using your environment, run:")
    print("conda activate forecaster-parity")


if __name__ == "__main__":
    main()

# python setup_env.py
# deactivate:
    # conda deactivate
    # conda env remove -n forecaster-parity
    # conda env list
