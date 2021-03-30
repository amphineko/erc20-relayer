FROM node:15.12-alpine

RUN apk --no-cache add tini

COPY ./package.json ./tsconfig.json ./yarn.lock /app/
COPY ./scripts/ /app/scripts/
COPY ./src/ /app/src/

WORKDIR /app

RUN set -ex && yarn install

ENTRYPOINT [ "/sbin/tini", "--" ]

CMD [ "yarn", "start" ]
