# Start with first build stage

FROM node:24-alpine AS build
ENV NODE_ENV=production

# Add and set non-root user. Disable the password and do not create a home folder.

RUN [ "adduser", "-D", "ackee", "ackee" ]
USER ackee

WORKDIR /srv/app/

# Add dependencies first so that Docker can use the cache as long as the dependencies stay unchanged

# The interface is built here, so it needs the dev dependencies too. They are removed again
# below, before the second stage copies the result.

COPY --chown=ackee:ackee package.json package-lock.json /srv/app/
RUN [ "npm", "ci", "--include=dev" ]

# Copy source after the dependency step as it's more likely that the source changes

COPY --chown=ackee:ackee build.js /srv/app/
COPY --chown=ackee:ackee src /srv/app/src
COPY --chown=ackee:ackee dist /srv/app/dist

# Build the interface from the source in this image. Without this the image would serve the
# bundle committed in dist/, which goes stale with every interface change.

RUN [ "npm", "run", "build:pre" ]
RUN [ "npm", "prune", "--omit=dev" ]

# Start with second build stage

FROM node:24-alpine
EXPOSE 3000

# Which build this image is, so a deploy can check that the stand runs what it shipped.

ARG ACKEE_BUILD=local
ENV ACKEE_BUILD=$ACKEE_BUILD
WORKDIR /srv/app/

# Copy the source from the build stage to the second stage

COPY --from=build /srv/app/ /srv/app/

# Create user/group to run as, change ownership of files and set user

RUN [ "adduser", "-D", "ackee", "ackee" ]
RUN [ "chown", "-R", "ackee:ackee", "/srv/app" ]
USER ackee

# Run healthcheck against MongoDB, server and API.
# Wait a bit before start to ensure the build is done.

HEALTHCHECK --interval=1m --timeout=45s --start-period=45s CMD [ "npm", "run", "healthcheck" ]

# Start Ackee

CMD [ "npm", "run", "start" ]
