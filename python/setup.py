import pathlib
from setuptools import find_packages, setup

HERE = pathlib.Path(__file__).parent
README = (HERE / "README.md").read_text()

setup(
    name='inhumate-rti',
    packages=[
        'inhumate_rti',
        'inhumate_rti.proto',
        'inhumate_rti.generated'
    ],
    version='0.0.1-dev-version',
    license='Proprietary',
    author='Inhumate AB',
    author_email='packages@inhumatesystems.com',
    url='https://gitlab.com/inhumate/rti',
    description='Inhumate RTI Client',
    long_description=README,
    long_description_content_type="text/markdown",
    keywords=['RTI'],
    install_requires=[
        'protobuf',
        'emitter.py',
        'websocket-client',
    ],
    entry_points = {
        "console_scripts": [ "protoscribe=inhumate_rti.protoscribe:main" ]
    },
    classifiers=[
        # Chose either "3 - Alpha", "4 - Beta" or "5 - Production/Stable" as the current state of your package
        'Development Status :: 3 - Alpha',
        'Intended Audience :: Developers',
        'License :: OSI Approved :: Apache Software License',
        'Programming Language :: Python :: 3',
        'Programming Language :: Python :: 3.6',
        'Programming Language :: Python :: 3.7',
    ],
)
