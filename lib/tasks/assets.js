var Task                = require('ember-cli/lib/models/task');
var ConfigurationReader = require('../utilities/configuration-reader');
var Promise             = require('ember-cli/lib/ext/promise');
var SilentError         = require('ember-cli/lib/errors/silent');
var AdapterRegistry     = require('../utilities/adapter-registry');
var chalk               = require('chalk');
var fs                  = require('fs');
var path                = require('path');

var ncp   = Promise.denodeify(require('ncp'));
var white = chalk.white;
var green = chalk.green;

var EXPIRE_IN_2030 = new Date('2030');
var TWO_YEAR_CACHE_PERIOD_IN_SEC = 60 * 60 * 24 * 365 * 2;

module.exports = Task.extend({
  run: function(options) {
    var broccoli  = require('broccoli');

    var config = new ConfigurationReader({
      environment: options.environment,
      configFile: options.deployConfigFile,
      project: this.project,
      ui: this.ui
    }).config;

    var fileTreeOrPath;
    if (config.get('assets.gzip') === false) {
      fileTreeOrPath = 'dist';
    } else {
      var gzipFiles = require('broccoli-gzip');

      fileTreeOrPath = gzipFiles('dist', {
        extensions: config.get('assets.gzipExtensions'),
        appendSuffix: false
      });
    }

    var builder = new broccoli.Builder(fileTreeOrPath);

    return builder.build()
      .then(this.processBuildResult.bind(this))
      .then(this.uploadAssets.bind(this, options.environment, options.deployConfigFile))
      .then(function() {
        builder.cleanup();
      });
  },

  uploadAssets: function(environment, configFile) {
    var config = new ConfigurationReader({
      environment: environment,
      configFile: configFile,
      project: this.project,
      ui: this.ui
    }).config;

    var taggingAdapterType = config.get('tagging');
    var manifest = this.project.name();

    var adapterRegistry = new AdapterRegistry({ project: this.project });

    var TaggingAdapter = adapterRegistry
      .lookup('tagging', taggingAdapterType)

    var taggingAdapter = new TaggingAdapter({
      manifest: manifest
    });


    var AssetsUploader = this.AssetsUploader;
    var assetsUploader = new AssetsUploader({
      ui: this.ui,
      config: config._materialize(),
      type: config.get('assets.type'),
      project: this.project,
      taggingAdapter: taggingAdapter
    });

    return assetsUploader.upload();
  },

  processBuildResult: function(results) {
    return this.clearOutputPath('tmp/assets-sync/')
    .then(function() {
      return this.copyToOutputPath(results.directory, 'tmp/assets-sync/');
    }.bind(this))
  },

  clearOutputPath: function(outputPath) {
    var rimraf = Promise.denodeify(require('rimraf'));
    if (!fs.existsSync(outputPath)) { return Promise.resolve(); }

    var promises = [];
    var entries = fs.readdirSync(outputPath);

    for (var i = 0, l = entries.length; i < l; i++) {
      promises.push(rimraf(path.join(outputPath, entries[i])));
    }

    return Promise.all(promises);
  },

  copyToOutputPath: function(inputPath, outputPath) {
    var mkdirp = require('mkdirp');
    if (!fs.existsSync(outputPath)) {
      mkdirp.sync(outputPath);
    }

    return ncp(inputPath, outputPath, {
      dereference: true,
      clobber: true,
      stopOnErr: true,
      limit: 2
    });
  }
});
