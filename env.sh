ARG=$1
PARAM=$2

AO_TOKEN=${AO_TOKEN_STG:-$AO_TOKEN_PROD}

if [[ -z "$AO_TOKEN" ]]; then
    echo "AO_TOKEN_PROD or AO_TOKEN_STG must be defined and contain a valid SolarWinds token"
    echo "for accessing a collector."
    return
fi

if [ "$AO_TOKEN" = "$AO_TOKEN_PROD" ]; then
    AO_COLLECTOR=collector.appoptics.com
else
    AO_COLLECTOR=collector-stg.appoptics.com
fi

# you made need to change this if you use NODE_PATH already. this
# allows node to find global modules implied in the agent development
# environment, e.g., tap, mocha, etc.
export NODE_PATH=${NVM_BIN}/../lib/node_modules

if [[ -z "$ARG" ]]; then
    echo "source this script with an argument of docker, docker-scribe, bash,"
    echo "bash-testing, or travis\n"
    echo "docker defines variables for running tests in the docker environment."
    echo "docker-scribe does the same but with the scribe collector instead of java"
    echo "  collector."
    echo "bash defines variables to run at a native command prompt. N.B. databases"
    echo "  will not necessarily be defined."
    echo "bash-testing defines the variables to test from the bash prompt but with docker"
    echo "  containers present."
    echo "travis - defines the variables for use in a travis environment."
    echo
    echo "you may also use the argument debug to define additional"
    echo "debugging variables, bindings to define alternate ao-bindings"
    echo "authentication and package, or tcpdump to get help on tcpdump"
elif [[ "$ARG" = "key" ]]; then
    if [[ -z "$PARAM" ]]; then
        echo "defining the service key requires a service name argument"
        return
    fi
    export APPOPTICS_SERVICE_KEY=${AO_TOKEN}:$PARAM
    echo "set APPOPTICS_SERVICE_KEY=$APPOPTICS_SERVICE_KEY"
elif [[ "$ARG" = "add-bin" ]]; then
    # add ./node_modules/.bin to PATH
    [[ ":$PATH" != *":$PWD/node_modules/.bin"* ]] && PATH="${PATH}:$PWD/node_modules/.bin"
elif [[ "$ARG" = "docker-java" ]]; then
    export APPOPTICS_TRUSTEDPATH=/appoptics/test/certs/java-collector.crt
    export APPOPTICS_COLLECTOR=java-collector:12222
    export APPOPTICS_SERVICE_KEY=${AO_TOKEN}:ao-node-test-docker
    export APPOPTICS_REPORTER=ssl
elif [[ "$ARG" = "docker-scribe" ]]; then
    export APPOPTICS_TRUSTEDPATH=/appoptics/test/certs/scribe-collector.crt
    export APPOPTICS_COLLECTOR=scribe-collector:4444
    export APPOPTICS_SERVICE_KEY=${AO_TOKEN}:ao-node-test-docker
    export APPOPTICS_REPORTER=ssl
elif [[ "$ARG" = "bash" ]]; then
    # this is used primarily for manual interactive testing so doesn't connect to a
    # real collector as most tests will fail if it does.
    [[ ":$PATH" != *":$PWD/node_modules/.bin"* ]] && PATH="${PATH}:$PWD/node_modules/.bin"

    # set logging that should be seen during testing.
    export APPOPTICS_LOG_SETTINGS=error,warn,patching,bind,debug

    export APPOPTICS_COLLECTOR=localhost:7832
    export APPOPTICS_SERVICE_KEY=${AO_TOKEN}:ao-node-test
    export APPOPTICS_REPORTER=udp

    # and the buckets need to be adjusted if using UDP because the defaults
    # result in lost messages without notification.
    export APPOPTICS_TOKEN_BUCKET_CAPACITY=1000
    export APPOPTICS_TOKEN_BUCKET_RATE=1000

    # the following are used primarily to run the full appoptics-apm test suite.
    # presumes docker containers are running and their ports are addressable
    # as localhost. the port overrides (e.g., AO_TEST_MYSQL_HOST_PORT) allow
    # existing local copies of the database that run on the standard port
    # numbers to be used for testing (and not conflict with the port docker
    # would normally expose).
    export AO_TEST_CASSANDRA_2_2=localhost:9042
    export AO_TEST_MEMCACHED_1_4=localhost:11211
    export AO_TEST_MONGODB_2_4=localhost:27016
    export AO_TEST_MONGODB_2_6=localhost:${AO_TEST_MONGO_2_6_HOST_PORT:-27017}
    export AO_TEST_MONGODB_3_0=localhost:27018
    #export AO_TEST_MONGODB_SET=localhost:30001,localhost:30002,localhost:30003
    DTS=ec2-52-7-124-5.compute-1.amazonaws.com
    export AO_TEST_MONGODB_SET=$DTS:10301,$DTS:10302,$DTS:10303

    # enable mysql to run with different port
    export AO_TEST_MYSQL=localhost:${AO_TEST_MYSQL_HOST_PORT:-3306}
    # if different port then use default user/password settings
    export AO_TEST_MYSQL_USERNAME=${AO_TEST_MYSQL_HOST_USERNAME:root}
    export AO_TEST_MYSQL_PASSWORD=${AO_TEST_MYSQL_HOST_PASSWORD+}
    # this requires an entry in /etc/hosts because this
    # isn't run in a container it can't use docker names.
    # use the IP address from "docker inspect ao_oracle_1"
    export AO_TEST_ORACLE=localhost:1521
    export AO_TEST_ORACLE_USERNAME=system
    export AO_TEST_ORACLE_PASSWORD=oracle
    # defaults should be fine.
    #export AO_TEST_POSTGRES_USER=postgres
    #export AO_TEST_POSTGRES_PASSWORD=
    export AO_TEST_POSTGRES=localhost:5432
    export AO_TEST_RABBITMQ_3_5=localhost:5672
    export AO_TEST_REDIS_3_0=localhost:6379
    # the tedious probe tests SQL Server.
    export AO_TEST_SQLSERVER_EX=localhost:1433
elif [[ "$ARG" = "stg" ]]; then
    export APPOPTICS_COLLECTOR=collector-stg.appoptics.com
    export APPOPTICS_SERVICE_KEY=${AO_TOKEN_STG}:ao-node-test
    export APPOPTICS_REPORTER=ssl
elif [[ "$ARG" = "prod" ]]; then
    export APPOPTICS_COLLECTOR=collector.appoptics.com
    export APPOPTICS_SERVICE_KEY=${AO_TOKEN_PROD}:ao-node-test
    export APPOPTICS_REPORTER=ssl
elif [[ "$ARG" = "bam-local-mongo" ]]; then
    # I have local copies running so this reassigns the ports that docker uses.
    AO_TEST_MONGO_2_6_HOST_PORT=27027
    AO_TEST_MYSQL_HOST_PORT=33306
elif [[ "$ARG" = "travis" ]]; then
    # travis has been retired in favor of the matrix tests
    ## presume a travis-ci environment. servers should be running
    ## as localhost on standard ports.
    #export AO_TEST_CASSANDRA_2_2=localhost:9042
    #export AO_TEST_MEMCACHED_1_4=localhost:11211
    ## only one mongodb is tested per travis run.
    #export AO_TEST_MONGODB_3=localhost:27017
    ## mysql/travis doesn't like 127.0.0.1 - must be localhost
    #export AO_TEST_MYSQL=localhost:3306
    #export AO_TEST_MYSQL_USERNAME=root
    #export AO_TEST_MYSQL_PASSWORD=admin
    ## this requires an entry in /etc/hosts because this
    ## isn't run in a container it can't use docker names.
    ## use the IP address from "docker inspect ao_oracle_1"
    #export AO_TEST_ORACLE=oracledb.com
    #export AO_TEST_ORACLE_USERNAME=system
    #export AO_TEST_ORACLE_PASSWORD=oracle
    ## defaults should be fine.
    ##export AO_TEST_POSTGRES_USER=postgres
    ##export AO_TEST_POSTGRES_PASSWORD=
    #export AO_TEST_POSTGRES=localhost:5432
    #export AO_TEST_RABBITMQ_3_5=localhost:5672
    #export AO_TEST_REDIS_3_0=localhost:6379
    ## the tedious probe tests SQL Server.
    #export AO_TEST_SQLSERVER_EX=mssql:1433
    #export AO_TEST_SQLSERVER_EX_USERNAME=sa
    echo "[WARNING] travis is no longer used"
elif [[ "$ARG" = "debug" ]]; then
    # this section is more for reference than anything else.
    # LEVEL 2 is most of what you want to see. 6 (highest) is too much.
    export APPOPTICS_DEBUG_LEVEL=2
    # see lib/loggers.js for all the options
    export APPOPTICS_LOG_SETTINGS=error,warn,debug,patching,bind
    export APPOPTICS_TOKEN_BUCKET_CAPACITY=1000
    export APPOPTICS_TOKEN_BUCKET_RATE=1000
elif [[ "$ARG" = "bindings" ]]; then
    # this is no longer used as appoptics is now public, open source software.
    ## use these to provide authentication and specify an alternate branch/tag
    ## for use by install-appoptics-bindings.js. the example below, given a git
    ## auth token in the variable AO_TEST_GITAUTH, will cause "npm run postinstall"
    ## to fetch appoptics-bindings directly from github. documentation is the code
    ## in install-appoptics-bindings.js
    #export AO_TEST_PACKAGE=appoptics/node-appoptics-bindings
    ## this requires that one's git access token is already defined.
    #export AO_TEST_GITAUTH=${AO_TOKEN_GIT}
    echo "[WARNING] bindings is no longer used"
elif [[ "$ARG" = "help" ]]; then
    echo "try"
    echo "    $ sudo tcpdump -i lo -n udp port 7832"
    echo "to watch the UDP traffic"
    #sudo tcpdump -i lo -n udp port 7832
else
    echo "ERROR $ARG invalid"
fi

return




